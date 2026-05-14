import { describe, expect, it } from "vitest";
import type { CliRenderer, KeyEvent } from "@opentui/core";
import type { CaptureModeState, CapturedTarget, CapturedTargetId } from "@anscribe/core";
import {
  CAPTURE_MOUSE_HANDLED,
  discoverMouseRenderables,
  readRendererSize,
  readRendererWidth,
  readSelectedTargets,
  shouldSelectFromMouseEvent,
  subscribeToKeypress,
} from "../../src/host-helpers";

// Helpers below all consume structural shapes; CliRenderer / KeyEvent / branded
// id types are satisfied via casts so tests can stay in Node without spinning up
// OpenTUI or the Effect schema decoder.

const tid = (value: string): CapturedTargetId => value as CapturedTargetId;

const target = (id: string): CapturedTarget =>
  ({
    id: tid(id),
    type: "BoxRenderable",
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    ancestry: ["Root"],
  }) as CapturedTarget;

const state = (overrides: Partial<CaptureModeState> = {}): CaptureModeState => ({
  active: false,
  targets: [],
  currentIndex: -1,
  selectedTargetIds: [],
  instructionDraft: false,
  ...overrides,
});

describe("subscribeToKeypress — feature detection", () => {
  it("returns undefined when renderer.keyInput is missing", () => {
    const renderer = { keyInput: undefined } as unknown as CliRenderer;
    expect(subscribeToKeypress(renderer, () => {})).toBeUndefined();
  });

  it("returns undefined when keyInput has neither prependListener nor on", () => {
    const renderer = { keyInput: {} } as unknown as CliRenderer;
    expect(subscribeToKeypress(renderer, () => {})).toBeUndefined();
  });

  it("prefers prependListener over on when both are present", () => {
    const calls: Array<{ method: string; event: string }> = [];
    const listener = (_event: KeyEvent): void => {};
    const renderer = {
      keyInput: {
        prependListener: (event: string) => calls.push({ method: "prependListener", event }),
        on: (event: string) => calls.push({ method: "on", event }),
      },
    } as unknown as CliRenderer;

    const cleanup = subscribeToKeypress(renderer, listener);

    expect(cleanup).toBeInstanceOf(Function);
    expect(calls).toEqual([{ method: "prependListener", event: "keypress" }]);
  });

  it("falls back to on when prependListener is missing", () => {
    const onArgs: Array<[string, unknown]> = [];
    const renderer = {
      keyInput: {
        on: (event: string, fn: unknown) => onArgs.push([event, fn]),
      },
    } as unknown as CliRenderer;

    const cleanup = subscribeToKeypress(renderer, () => {});

    expect(cleanup).toBeInstanceOf(Function);
    expect(onArgs).toHaveLength(1);
    expect(onArgs[0]?.[0]).toBe("keypress");
  });
});

describe("subscribeToKeypress — cleanup", () => {
  it("prefers off over removeListener", () => {
    const calls: string[] = [];
    const renderer = {
      keyInput: {
        on: () => {},
        off: () => calls.push("off"),
        removeListener: () => calls.push("removeListener"),
      },
    } as unknown as CliRenderer;

    const cleanup = subscribeToKeypress(renderer, () => {});
    cleanup?.();

    expect(calls).toEqual(["off"]);
  });

  it("falls back to removeListener when off is missing", () => {
    const calls: string[] = [];
    const renderer = {
      keyInput: {
        on: () => {},
        removeListener: () => calls.push("removeListener"),
      },
    } as unknown as CliRenderer;

    subscribeToKeypress(renderer, () => {})?.();

    expect(calls).toEqual(["removeListener"]);
  });

  it("is a no-op when neither off nor removeListener exist", () => {
    const renderer = {
      keyInput: { on: () => {} },
    } as unknown as CliRenderer;

    expect(() => subscribeToKeypress(renderer, () => {})?.()).not.toThrow();
  });
});

describe("discoverMouseRenderables", () => {
  const renderable = (overrides: {
    typeName?: string;
    visible?: boolean;
    processMouseEvent?: unknown;
    children?: ReadonlyArray<Record<string, unknown>>;
  }): Record<string, unknown> => ({
    constructor: { name: overrides.typeName ?? "BoxRenderable" },
    visible: overrides.visible ?? true,
    getChildren: () => overrides.children ?? [],
    ...(overrides.processMouseEvent !== undefined && {
      processMouseEvent: overrides.processMouseEvent,
    }),
  });

  it("returns empty when no renderable has processMouseEvent", () => {
    const root = renderable({});
    const renderer = { root } as unknown as CliRenderer;
    expect(discoverMouseRenderables(renderer)).toEqual([]);
  });

  it("includes renderables whose processMouseEvent is a function", () => {
    const child = renderable({ typeName: "Mouse", processMouseEvent: () => {} });
    const root = renderable({ children: [child] });
    const renderer = { root } as unknown as CliRenderer;
    expect(discoverMouseRenderables(renderer)).toEqual([child]);
  });

  it("excludes renderables whose processMouseEvent is not a function", () => {
    const fake = renderable({ processMouseEvent: "not-a-function" });
    const renderer = { root: fake } as unknown as CliRenderer;
    expect(discoverMouseRenderables(renderer)).toEqual([]);
  });

  it("excludes invisible renderables even if they have processMouseEvent", () => {
    const hidden = renderable({
      visible: false,
      processMouseEvent: () => {},
    });
    const renderer = { root: hidden } as unknown as CliRenderer;
    expect(discoverMouseRenderables(renderer)).toEqual([]);
  });

  it("walks the full tree (nested descendants are visited)", () => {
    const deep = renderable({ typeName: "Deep", processMouseEvent: () => {} });
    const middle = renderable({ typeName: "Middle", children: [deep] });
    const root = renderable({
      typeName: "Root",
      processMouseEvent: () => {},
      children: [middle],
    });
    const renderer = { root } as unknown as CliRenderer;
    const result = discoverMouseRenderables(renderer);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(root);
    expect(result[1]).toBe(deep);
  });
});

describe("readRendererWidth", () => {
  it("reads renderer.width when present and finite", () => {
    const renderer = { width: 120, root: {} } as unknown as CliRenderer;
    expect(readRendererWidth(renderer)).toBe(120);
  });

  it("falls back to renderer.root.width when renderer.width is missing", () => {
    const renderer = { root: { width: 64 } } as unknown as CliRenderer;
    expect(readRendererWidth(renderer)).toBe(64);
  });

  it("falls back to 80 when both renderer.width and root.width are missing", () => {
    const renderer = { root: {} } as unknown as CliRenderer;
    expect(readRendererWidth(renderer)).toBe(80);
  });

  it("falls back to 80 when widths read as 0", () => {
    const renderer = { width: 0, root: { width: 0 } } as unknown as CliRenderer;
    expect(readRendererWidth(renderer)).toBe(80);
  });

  it("falls back to 80 when widths are non-finite", () => {
    const renderer = {
      width: Number.NaN,
      root: { width: Number.POSITIVE_INFINITY },
    } as unknown as CliRenderer;
    expect(readRendererWidth(renderer)).toBe(80);
  });
});

describe("readSelectedTargets", () => {
  it("returns empty when no targets are selected", () => {
    expect(readSelectedTargets(state({ targets: [target("a")] }))).toEqual([]);
  });

  it("returns selected targets in selection order", () => {
    const a = target("a");
    const b = target("b");
    const c = target("c");
    const result = readSelectedTargets(
      state({
        targets: [a, b, c],
        selectedTargetIds: [tid("c"), tid("a")],
      }),
    );
    expect(result).toEqual([c, a]);
  });

  it("filters out IDs that don't resolve to a target", () => {
    const a = target("a");
    const result = readSelectedTargets(
      state({
        targets: [a],
        selectedTargetIds: [tid("a"), tid("missing")],
      }),
    );
    expect(result).toEqual([a]);
  });
});

describe("readRendererSize", () => {
  it("reads renderer.width / height when present", () => {
    const renderer = { width: 120, height: 40, root: {} } as unknown as CliRenderer;
    expect(readRendererSize(renderer)).toEqual({ width: 120, height: 40 });
  });

  it("falls back to renderer.root dimensions when renderer is missing them", () => {
    const renderer = { root: { width: 64, height: 18 } } as unknown as CliRenderer;
    expect(readRendererSize(renderer)).toEqual({ width: 64, height: 18 });
  });

  it("falls back to 80 x 24 when both renderer and root are missing dimensions", () => {
    const renderer = { root: {} } as unknown as CliRenderer;
    expect(readRendererSize(renderer)).toEqual({ width: 80, height: 24 });
  });
});

describe("shouldSelectFromMouseEvent", () => {
  const event = (overrides: {
    type?: string;
    button?: number;
    handled?: boolean;
  }): Parameters<typeof shouldSelectFromMouseEvent>[0] => ({
    type: overrides.type ?? "down",
    button: overrides.button ?? 0,
    x: 0,
    y: 0,
    preventDefault: () => {},
    stopPropagation: () => {},
    ...(overrides.handled === true && { [CAPTURE_MOUSE_HANDLED]: true }),
  });

  it("accepts a fresh primary-button down event", () => {
    expect(shouldSelectFromMouseEvent(event({}))).toBe(true);
  });

  it("rejects non-down event types", () => {
    expect(shouldSelectFromMouseEvent(event({ type: "up" }))).toBe(false);
    expect(shouldSelectFromMouseEvent(event({ type: "move" }))).toBe(false);
  });

  it("rejects non-primary buttons", () => {
    expect(shouldSelectFromMouseEvent(event({ button: 1 }))).toBe(false);
    expect(shouldSelectFromMouseEvent(event({ button: 2 }))).toBe(false);
  });

  it("rejects events already marked as handled", () => {
    expect(shouldSelectFromMouseEvent(event({ handled: true }))).toBe(false);
  });
});
