import {
  BoxRenderable,
  RGBA,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import {
  markAsOverlay,
  resolveTargetAtCell,
  selectCurrentTarget,
  type CapturedTarget,
  type CapturedTargetId,
  type PickerState,
  type TerminalCellBounds,
} from "@anscribe/core";
import { generateRenderableIdSuffix } from "./internal/ids";
import {
  CAPTURE_MOUSE_HANDLED,
  discoverMouseRenderables,
  readSelectedTargets,
  shouldSelectFromMouseEvent,
  subscribeToKeypress,
  type CaptureMouseEvent,
  type CaptureMouseRenderable,
} from "./host-helpers";
import {
  INSPECTOR_BORDER_COLOR,
  INSPECTOR_DIM_COLOR,
  INSPECTOR_MIN_HEIGHT,
  INSPECTOR_TEXT_COLOR,
  INSPECTOR_WIDTH,
  formatInspectorLines,
} from "./inspector";

type InspectorContent =
  | { readonly kind: "target"; readonly lines: readonly string[] }
  | { readonly kind: "placeholder"; readonly lines: readonly string[] };

// host-core owns every renderable side effect that's Picker-driven —
// highlight overlay, hover inspector, mouse-handler patching, keypress
// subscription. Capture composes this substrate and layers on its
// product-specific intents (instruction draft + persistence).

// Defaults: cyan under-cursor + magenta selected. Both hues stay saturated
// when alpha-blended over near-black terminal backgrounds — warm tones
// (amber, green) lose chroma the same way and read as olive/mud at this
// alpha.
const DEFAULT_HIGHLIGHT_HEX = "#06b6d4";
const DEFAULT_SELECTED_HEX = "#ec4899";
const HIGHLIGHT_ALPHA = 100;
const SELECTED_ALPHA = 130;

const HOVER_PLACEHOLDER_MESSAGE = "Move mouse over a target";
const INSPECTOR_BACKGROUND_RGBA = RGBA.fromValues(0, 0, 0, 0.6);
const INSPECTOR_ID_PREFIX = "anscribe-inspector-";

// zIndex tiers — overlays stack: app content < selected < highlight < inspector.
// Inspector stays topmost so the highlight tint never bleeds through it
// (this was the original post-process bug). Highlight sits above selected
// so a target that's both selected and currently focused reads as cyan.
const SELECTED_OVERLAY_Z_INDEX = 999_998;
const HIGHLIGHT_OVERLAY_Z_INDEX = 999_999;
const HIGHLIGHT_OVERLAY_ID_PREFIX = "anscribe-highlight-";
const SELECTED_OVERLAY_ID_PREFIX = "anscribe-selected-";

export interface PickerHostCoreOptions {
  /** Primary-button click inside Picker mode. Product translates to its own dispatch. */
  readonly onPrimaryClick: (event: CaptureMouseEvent) => void;
  /** Keypress event. Product routes to its own intent set. */
  readonly onKeypress: (event: KeyEvent) => void;
  /** Hex color (e.g. "#ffd166") drawn over the target under the cursor. */
  readonly highlightColor?: string;
  /** Hex color drawn over each selected target. */
  readonly selectedColor?: string;
}

export interface PickerHostCore {
  /** Call after every dispatch so highlight + inspector + mouse-patch sync. */
  readonly syncRenderables: (next: PickerState) => void;
  /** Request a renderer repaint. */
  readonly requestRender: () => void;
  /** Tear down overlays, restore mouse handlers, remove keypress listener. */
  readonly dispose: () => void;
}

export function installPickerHostCore(
  renderer: CliRenderer,
  initialState: PickerState,
  options: PickerHostCoreOptions,
): PickerHostCore {
  const highlightRGBA = hexToOverlayRGBA(
    options.highlightColor ?? DEFAULT_HIGHLIGHT_HEX,
    HIGHLIGHT_ALPHA,
  );
  const selectedRGBA = hexToOverlayRGBA(
    options.selectedColor ?? DEFAULT_SELECTED_HEX,
    SELECTED_ALPHA,
  );

  let lastSyncedState: PickerState = initialState;
  let hoveredTargetId: CapturedTargetId | undefined;

  const requestRender = (): void => {
    renderer.requestRender?.();
  };

  // The highlight + each selected target render as BoxRenderables with a
  // semi-transparent background. OpenTUI's normal z-sort then ensures the
  // inspector (at higher zIndex) draws on top — no manual rect-subtraction
  // needed. Replaces the old `addPostProcessFn` fillRect pass.
  let highlightOverlay: BoxRenderable | undefined;
  const selectedOverlays = new Map<CapturedTargetId, BoxRenderable>();

  const makeOverlay = (
    target: CapturedTarget,
    background: RGBA,
    zIndex: number,
    idPrefix: string,
  ): BoxRenderable => {
    const overlay = new BoxRenderable(renderer, {
      id: `${idPrefix}${generateRenderableIdSuffix()}`,
      position: "absolute",
      left: target.bounds.x,
      top: target.bounds.y,
      width: Math.max(target.bounds.width, 1),
      height: Math.max(target.bounds.height, 1),
      zIndex,
      backgroundColor: background,
      shouldFill: true,
    });
    markAsOverlay(overlay);
    renderer.root.add(overlay);
    return overlay;
  };

  const applyOverlayBounds = (overlay: BoxRenderable, bounds: TerminalCellBounds): void => {
    overlay.left = bounds.x;
    overlay.top = bounds.y;
    overlay.width = Math.max(bounds.width, 1);
    overlay.height = Math.max(bounds.height, 1);
  };

  const destroyHighlightOverlay = (): void => {
    if (highlightOverlay === undefined) return;
    highlightOverlay.destroyRecursively();
    highlightOverlay = undefined;
  };

  const destroyAllSelectedOverlays = (): void => {
    for (const overlay of selectedOverlays.values()) overlay.destroyRecursively();
    selectedOverlays.clear();
  };

  const syncHighlightOverlay = (state: PickerState): void => {
    const highlighted = selectCurrentTarget(state);
    const selectedTargets = state.active ? readSelectedTargets(state) : [];

    const wantSelectedIds = new Set(selectedTargets.map((target) => target.id));
    for (const [id, overlay] of selectedOverlays) {
      if (wantSelectedIds.has(id)) continue;
      overlay.destroyRecursively();
      selectedOverlays.delete(id);
    }
    for (const target of selectedTargets) {
      const existing = selectedOverlays.get(target.id);
      if (existing !== undefined) {
        applyOverlayBounds(existing, target.bounds);
        continue;
      }
      selectedOverlays.set(
        target.id,
        makeOverlay(target, selectedRGBA, SELECTED_OVERLAY_Z_INDEX, SELECTED_OVERLAY_ID_PREFIX),
      );
    }

    if (highlighted === undefined) {
      destroyHighlightOverlay();
    } else if (highlightOverlay === undefined) {
      highlightOverlay = makeOverlay(
        highlighted,
        highlightRGBA,
        HIGHLIGHT_OVERLAY_Z_INDEX,
        HIGHLIGHT_OVERLAY_ID_PREFIX,
      );
    } else {
      applyOverlayBounds(highlightOverlay, highlighted.bounds);
    }

    requestRender();
  };

  type LiveInspector = { container: BoxRenderable; text: TextRenderable };
  let liveInspector: LiveInspector | undefined;
  let lastSyncedInspectorLines: readonly string[] | undefined;

  const destroyInspector = (): void => {
    if (liveInspector === undefined) return;
    liveInspector.container.destroyRecursively();
    liveInspector = undefined;
    lastSyncedInspectorLines = undefined;
  };

  const ensureInspector = (): LiveInspector => {
    if (liveInspector !== undefined) return liveInspector;

    const container = new BoxRenderable(renderer, {
      id: `${INSPECTOR_ID_PREFIX}${generateRenderableIdSuffix()}`,
      position: "absolute",
      right: 1,
      top: 1,
      width: INSPECTOR_WIDTH,
      height: INSPECTOR_MIN_HEIGHT,
      zIndex: 1_000_000,
      border: true,
      borderStyle: "single",
      borderColor: INSPECTOR_BORDER_COLOR,
      backgroundColor: INSPECTOR_BACKGROUND_RGBA,
      shouldFill: true,
      title: "inspector",
      paddingX: 1,
    });
    const text = new TextRenderable(renderer, {
      id: `${container.id}-text`,
      content: "",
      fg: INSPECTOR_TEXT_COLOR,
    });
    markAsOverlay(container);
    markAsOverlay(text);
    container.add(text);
    renderer.root.add(container);
    liveInspector = { container, text };
    return liveInspector;
  };

  const syncInspector = (state: PickerState): void => {
    const content = computeInspectorContent(state, hoveredTargetId);
    if (content === undefined) {
      destroyInspector();
      return;
    }

    const lines = content.lines;
    const inspector = ensureInspector();
    inspector.container.height = Math.max(lines.length + 2, INSPECTOR_MIN_HEIGHT);

    if (
      lastSyncedInspectorLines === undefined ||
      lastSyncedInspectorLines.length !== lines.length ||
      lastSyncedInspectorLines.some((line, index) => line !== lines[index])
    ) {
      inspector.text.content = lines.join("\n");
      inspector.text.fg =
        content.kind === "placeholder" ? INSPECTOR_DIM_COLOR : INSPECTOR_TEXT_COLOR;
      lastSyncedInspectorLines = lines;
    }
  };

  const updateHoverFromEvent = (event: CaptureMouseEvent): void => {
    if (!lastSyncedState.active) return;
    const target = resolveTargetAtCell(lastSyncedState.targets, event.x, event.y);
    const nextHoveredId = target?.id;
    if (nextHoveredId === hoveredTargetId) return;
    hoveredTargetId = nextHoveredId;
    syncInspector(lastSyncedState);
    requestRender();
  };

  const mousePatches = new Map<CaptureMouseRenderable, (event: CaptureMouseEvent) => void>();

  const restoreMouseHandlers = (): void => {
    for (const [renderable, processMouseEvent] of mousePatches) {
      renderable.processMouseEvent = processMouseEvent;
    }
    mousePatches.clear();
  };

  const patchMouseHandlers = (): void => {
    for (const renderable of discoverMouseRenderables(renderer)) {
      if (mousePatches.has(renderable)) continue;

      const originalProcessMouseEvent = renderable.processMouseEvent.bind(renderable);
      mousePatches.set(renderable, originalProcessMouseEvent);

      renderable.processMouseEvent = (event) => {
        if (lastSyncedState.active) {
          if (event.type === "move" || event.type === "drag") {
            updateHoverFromEvent(event);
          } else if (shouldSelectFromMouseEvent(event)) {
            event[CAPTURE_MOUSE_HANDLED] = true;
            options.onPrimaryClick(event);
            event.preventDefault();
            event.stopPropagation();
            requestRender();
            return;
          }
        }
        originalProcessMouseEvent(event);
      };
    }
  };

  const clearHover = (): void => {
    if (hoveredTargetId === undefined) return;
    hoveredTargetId = undefined;
  };

  const syncRenderables = (next: PickerState): void => {
    const previous = lastSyncedState;
    lastSyncedState = next;

    if (!previous.active && next.active) {
      patchMouseHandlers();
    } else if (previous.active && !next.active) {
      restoreMouseHandlers();
      clearHover();
    }

    if (
      hoveredTargetId !== undefined &&
      !next.targets.some((target) => target.id === hoveredTargetId)
    ) {
      clearHover();
    }

    syncHighlightOverlay(next);
    syncInspector(next);
  };

  const removeKeypressListener = subscribeToKeypress(renderer, options.onKeypress);

  // Initial sync — idempotent for the initial state but ensures overlays
  // reflect any non-default state the product handed us.
  syncRenderables(initialState);

  return {
    syncRenderables,
    requestRender,
    dispose: () => {
      removeKeypressListener?.();
      destroyInspector();
      destroyHighlightOverlay();
      destroyAllSelectedOverlays();
      restoreMouseHandlers();
    },
  };
}

function computeInspectorContent(
  state: PickerState,
  hoveredTargetId: CapturedTargetId | undefined,
): InspectorContent | undefined {
  if (!state.active) return undefined;

  const hovered =
    hoveredTargetId !== undefined
      ? state.targets.find((target) => target.id === hoveredTargetId)
      : undefined;
  if (hovered !== undefined) {
    return { kind: "target", lines: formatInspectorLines(hovered) };
  }

  const firstSelected = readSelectedTargets(state)[0];
  if (firstSelected !== undefined) {
    return { kind: "target", lines: formatInspectorLines(firstSelected) };
  }

  const current = selectCurrentTarget(state);
  if (current !== undefined) {
    return { kind: "target", lines: formatInspectorLines(current) };
  }

  if (state.targets.length > 0) {
    return { kind: "placeholder", lines: [HOVER_PLACEHOLDER_MESSAGE] };
  }

  return undefined;
}

function hexToOverlayRGBA(hex: string, alpha0to255: number): RGBA {
  const cleaned = hex.replace(/^#/, "");
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return RGBA.fromInts(r, g, b, alpha0to255);
}
