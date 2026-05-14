import type { CliRenderer, KeyEvent } from "@opentui/core";
import { isAnscribeOverlay, type CapturedTarget, type PickerState } from "@anscribe/core";
import {
  asRenderableRecord,
  isRenderableVisible,
  readFiniteNumber,
  walkRenderableTree,
  type RenderableRecord,
} from "./renderable-tree";

export const CAPTURE_MOUSE_HANDLED: unique symbol = Symbol("anscribe.captureMouseHandled");

export type CaptureMouseEvent = {
  type: string;
  button: number;
  x: number;
  y: number;
  preventDefault(): void;
  stopPropagation(): void;
  [CAPTURE_MOUSE_HANDLED]?: boolean;
};

export type CaptureMouseRenderable = RenderableRecord & {
  processMouseEvent(event: CaptureMouseEvent): void;
};

export type CaptureKeyInput = {
  on?: (event: "keypress", listener: (event: KeyEvent) => void) => unknown;
  off?: (event: "keypress", listener: (event: KeyEvent) => void) => unknown;
  prependListener?: (event: "keypress", listener: (event: KeyEvent) => void) => unknown;
  removeListener?: (event: "keypress", listener: (event: KeyEvent) => void) => unknown;
};

export function readSelectedTargets(state: PickerState): CapturedTarget[] {
  return state.selectedTargetIds
    .map((targetId) => state.targets.find((target) => target.id === targetId))
    .filter((target): target is CapturedTarget => target !== undefined);
}

export function subscribeToKeypress(
  renderer: CliRenderer,
  listener: (event: KeyEvent) => void,
): (() => void) | undefined {
  const keyInput = renderer.keyInput as CaptureKeyInput | undefined;

  if (keyInput === undefined) {
    return undefined;
  }

  if (typeof keyInput.prependListener === "function") {
    keyInput.prependListener("keypress", listener);
  } else if (typeof keyInput.on === "function") {
    keyInput.on("keypress", listener);
  } else {
    return undefined;
  }

  return () => {
    if (typeof keyInput.off === "function") {
      keyInput.off("keypress", listener);
      return;
    }

    if (typeof keyInput.removeListener === "function") {
      keyInput.removeListener("keypress", listener);
    }
  };
}

export function readRendererWidth(renderer: CliRenderer): number {
  const rendererRecord = asRenderableRecord(renderer);
  const rootRecord = asRenderableRecord(renderer.root);

  return readFiniteNumber(rendererRecord?.width ?? rootRecord?.width) || 80;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export function readRendererSize(renderer: CliRenderer): ViewportSize {
  const rendererRecord = asRenderableRecord(renderer);
  const rootRecord = asRenderableRecord(renderer.root);

  return {
    width: readFiniteNumber(rendererRecord?.width ?? rootRecord?.width) || 80,
    height: readFiniteNumber(rendererRecord?.height ?? rootRecord?.height) || 24,
  };
}

export function shouldSelectFromMouseEvent(event: CaptureMouseEvent): boolean {
  return event.type === "down" && event.button === 0 && event[CAPTURE_MOUSE_HANDLED] !== true;
}

export function discoverMouseRenderables(renderer: CliRenderer): CaptureMouseRenderable[] {
  const mouseRenderables: CaptureMouseRenderable[] = [];

  walkRenderableTree(
    renderer.root,
    (renderable) => {
      if (isRenderableVisible(renderable) && hasProcessMouseEvent(renderable)) {
        mouseRenderables.push(renderable);
      }
    },
    { shouldSkipSubtree: isAnscribeOverlay },
  );

  return mouseRenderables;
}

function hasProcessMouseEvent(renderable: RenderableRecord): renderable is CaptureMouseRenderable {
  return typeof renderable.processMouseEvent === "function";
}
