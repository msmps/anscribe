import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import {
  CaptureHostFailureReporter,
  CaptureMetadataEnrichment,
  CaptureMode,
  CaptureModeIntent,
  CapturePersistence,
  markAsOverlay,
  selectCurrentTarget,
  type CaptureModeDispatchResult,
  type CaptureModeState,
  type TerminalCellBounds,
} from "@anscribe/core";
import { Effect, Fiber, Layer } from "effect";
import { discoverVisibleTargets, type DiscoverVisibleTargetsOptions } from "./discovery";
import { generateRenderableIdSuffix } from "./internal/ids";
import {
  readRendererSize,
  readRendererWidth,
  readSelectedTargets,
  type CaptureMouseEvent,
  type ViewportSize,
} from "./host-helpers";
import { installPickerHostCore } from "./host-core";
import { readKeyEventInput, routeCaptureKey } from "./keys";

const INSTRUCTION_BORDER_COLOR = "#ffffff";
const INSTRUCTION_TEXT_COLOR = "#ffffff";
const INSTRUCTION_BACKGROUND_COLOR = "#000000";
const INSTRUCTION_HEIGHT = 3;

type CaptureInstructionDraft = {
  container?: BoxRenderable;
  input?: InputRenderable;
  // Pinned to the anchor target's bounds; placement is re-derived from this
  // on every resize so the input keeps tracking the target across viewport
  // changes.
  targetBounds: TerminalCellBounds;
};

export interface CaptureHostOptions {
  readonly keybinding?: string;
  /** Hex color (e.g. "#ffd166") drawn over the target under the cursor. */
  readonly highlightColor?: string;
  /** Hex color drawn over each selected target. */
  readonly selectedColor?: string;
}

export function makeCaptureHostLayer(renderer: CliRenderer, options: CaptureHostOptions = {}) {
  return Layer.effectDiscard(buildCaptureHost(renderer, options));
}

const buildCaptureHost = (renderer: CliRenderer, options: CaptureHostOptions) =>
  Effect.gen(function* () {
    const captureMode = yield* CaptureMode;
    const capturePersistence = yield* CapturePersistence;
    const enrichment = yield* CaptureMetadataEnrichment;
    const failureReporter = yield* CaptureHostFailureReporter;
    const captureModeContext = yield* Effect.context<never>();
    const pendingPersistence = new Set<Fiber.Fiber<void, never>>();

    const discoveryOptions: DiscoverVisibleTargetsOptions = {
      metadataEnricher: (input) => enrichment.enrich(input),
    };

    const initialState = yield* captureMode.current();
    let lastSyncedState: CaptureModeState = initialState;

    // The InputRenderable owns the draft body; we react to its ENTER event
    // and pass the value as CommitDraft payload. No per-keystroke mirroring.
    let liveInstructionDraft: CaptureInstructionDraft | undefined;

    const commitDraftFromInput = (body: string): void => {
      dispatch(CaptureModeIntent.CommitDraft({ body }));
    };

    const syncInstructionDraftRenderable = (state: CaptureModeState): void => {
      if (!state.instructionDraft) {
        if (liveInstructionDraft !== undefined) {
          destroyInstructionDraft(liveInstructionDraft);
          liveInstructionDraft = undefined;
        }
        return;
      }

      if (liveInstructionDraft === undefined) {
        // StartDraft is a no-op without a target, so by the time the draft
        // is open we always have an anchor target to pin against.
        const target = readAnchorTarget(state);
        if (target === undefined) return;
        liveInstructionDraft = createInstructionDraft(
          renderer,
          commitDraftFromInput,
          target.bounds,
        );
      }
    };

    const dispatch = (intent: CaptureModeIntent): void => {
      const previous = lastSyncedState;

      const result = Effect.runSyncWith(captureModeContext)(
        captureMode
          .dispatch(intent)
          .pipe(
            Effect.catch(
              (error): Effect.Effect<CaptureModeDispatchResult> =>
                Effect.as(failureReporter.report(error), { state: previous }),
            ),
          ),
      );
      const next = result.state;

      lastSyncedState = next;
      hostCore.syncRenderables(next);
      syncInstructionDraftRenderable(next);

      if (result.toPersist !== undefined) {
        const fiber = Effect.runForkWith(captureModeContext)(
          capturePersistence
            .createCapture(result.toPersist)
            .pipe(Effect.catch((error) => failureReporter.report(error))),
        );
        fiber.addObserver(() => {
          pendingPersistence.delete(fiber);
        });

        pendingPersistence.add(fiber);
      }
    };

    const handleKeypress = (event: KeyEvent): void => {
      const route = routeCaptureKey({
        state: lastSyncedState,
        key: readKeyEventInput(event),
        keybinding: options.keybinding,
      });

      if (route === undefined) return;

      if (route._tag === "EnterMode") {
        const targets = Effect.runSyncWith(captureModeContext)(
          discoverVisibleTargets(renderer.root, discoveryOptions).pipe(
            Effect.catch((error) => Effect.as(failureReporter.report(error), [])),
          ),
        );
        dispatch(CaptureModeIntent.EnterMode({ targets }));
      } else {
        dispatch(route.intent);
      }

      event.preventDefault();
      event.stopPropagation();
      hostCore.requestRender();
    };

    const hostCore = installPickerHostCore(renderer, initialState, {
      onPrimaryClick: (event: CaptureMouseEvent) => {
        // Click on the underlying app while the draft is open = dismiss.
        // Clicks inside the input itself hit-test on the overlay and never
        // reach this handler, so this only fires for true "click-away".
        if (lastSyncedState.instructionDraft) {
          dispatch(CaptureModeIntent.CancelDraft());
          return;
        }
        dispatch(CaptureModeIntent.SelectAtCell({ x: event.x, y: event.y }));
      },
      onKeypress: handleKeypress,
      highlightColor: options.highlightColor,
      selectedColor: options.selectedColor,
    });

    // Keeps the draft within the new viewport, recomputing placement from
    // the original anchor. Highlight overlay intentionally NOT refreshed;
    // bounds are frozen at EnterMode. OpenTUI debounces "resize" upstream
    // so no per-pixel thrash here.
    const handleResize = (): void => {
      if (liveInstructionDraft === undefined) return;
      resizeInstructionDraft(liveInstructionDraft, renderer);
      hostCore.requestRender();
    };
    renderer.on("resize", handleResize);

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        dispatch(CaptureModeIntent.ExitMode());
        renderer.off("resize", handleResize);
        if (liveInstructionDraft !== undefined) {
          destroyInstructionDraft(liveInstructionDraft);
          liveInstructionDraft = undefined;
        }
        hostCore.dispose();
        yield* Fiber.awaitAll(pendingPersistence).pipe(Effect.asVoid);
      }),
    );

    return undefined;
  });

function computeDraftWidths(renderer: CliRenderer): { boxWidth: number; inputWidth: number } {
  const boxWidth = Math.max(Math.min(readRendererWidth(renderer), 44), 18);
  return { boxWidth, inputWidth: Math.max(boxWidth - 4, 1) };
}

const PLACEMENT_PADDING = 1;

function computeDraftPlacement(
  viewport: ViewportSize,
  width: number,
  targetBounds: TerminalCellBounds,
): { readonly left: number; readonly top: number } {
  // Walk the four sides in left → right → below → above order and pick the
  // first side whose natural placement fits inside the viewport. If none
  // fits cleanly, fall back to the left candidate clamped — overlapping the
  // target is acceptable for targets that fill most of the screen.
  const candidates = [
    { left: targetBounds.x - width - PLACEMENT_PADDING, top: targetBounds.y },
    { left: targetBounds.x + targetBounds.width + PLACEMENT_PADDING, top: targetBounds.y },
    { left: targetBounds.x, top: targetBounds.y + targetBounds.height + PLACEMENT_PADDING },
    { left: targetBounds.x, top: targetBounds.y - INSTRUCTION_HEIGHT - PLACEMENT_PADDING },
  ];

  for (const candidate of candidates) {
    if (
      candidate.left >= 0 &&
      candidate.top >= 0 &&
      candidate.left + width <= viewport.width &&
      candidate.top + INSTRUCTION_HEIGHT <= viewport.height
    ) {
      return candidate;
    }
  }

  const fallback = candidates[0]!;
  return {
    left: Math.max(0, Math.min(fallback.left, Math.max(viewport.width - width, 0))),
    top: Math.max(0, Math.min(fallback.top, Math.max(viewport.height - INSTRUCTION_HEIGHT, 0))),
  };
}

function readAnchorTarget(state: CaptureModeState) {
  return readSelectedTargets(state)[0] ?? selectCurrentTarget(state);
}

function createInstructionDraft(
  renderer: CliRenderer,
  onSubmit: (value: string) => void,
  targetBounds: TerminalCellBounds,
): CaptureInstructionDraft {
  const { boxWidth, inputWidth } = computeDraftWidths(renderer);
  const placement = computeDraftPlacement(readRendererSize(renderer), boxWidth, targetBounds);
  const container = new BoxRenderable(renderer, {
    id: `anscribe-capture-instruction-${generateRenderableIdSuffix()}`,
    position: "absolute",
    left: placement.left,
    top: placement.top,
    width: boxWidth,
    height: INSTRUCTION_HEIGHT,
    zIndex: 10_000,
    border: true,
    borderStyle: "single",
    borderColor: INSTRUCTION_BORDER_COLOR,
    backgroundColor: INSTRUCTION_BACKGROUND_COLOR,
    shouldFill: true,
    title: "capture instruction",
    paddingX: 1,
  });
  const input = new InputRenderable(renderer, {
    id: `${container.id}-input`,
    width: inputWidth,
    value: "",
    placeholder: "enter instruction",
    backgroundColor: INSTRUCTION_BACKGROUND_COLOR,
    focusedBackgroundColor: INSTRUCTION_BACKGROUND_COLOR,
    textColor: INSTRUCTION_TEXT_COLOR,
    focusedTextColor: INSTRUCTION_TEXT_COLOR,
    placeholderColor: "#777777",
    cursorColor: INSTRUCTION_BORDER_COLOR,
  });

  input.on(InputRenderableEvents.ENTER, onSubmit);
  markAsOverlay(container);
  markAsOverlay(input);
  container.add(input);
  renderer.root.add(container);
  input.focus();

  return { container, input, targetBounds };
}

function resizeInstructionDraft(draft: CaptureInstructionDraft, renderer: CliRenderer): void {
  const { boxWidth, inputWidth } = computeDraftWidths(renderer);
  const placement = computeDraftPlacement(readRendererSize(renderer), boxWidth, draft.targetBounds);
  if (draft.container !== undefined) {
    draft.container.width = boxWidth;
    draft.container.left = placement.left;
    draft.container.top = placement.top;
  }
  if (draft.input !== undefined) draft.input.width = inputWidth;
}

function destroyInstructionDraft(draft: CaptureInstructionDraft | undefined): void {
  if (draft === undefined) return;

  if (draft.input !== undefined) {
    draft.input.blur();
    draft.input = undefined;
  }

  draft.container?.destroyRecursively();
  draft.container = undefined;
}
