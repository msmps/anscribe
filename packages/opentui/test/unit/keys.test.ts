import { describe, expect, it } from "vitest";
import type { KeyEvent } from "@opentui/core";
import {
  CaptureModeIntent,
  type CaptureModeState,
  type CapturedTarget,
  type CapturedTargetId,
  initialState,
} from "@anscribe/core";
import { readKeyEventInput, routeCaptureKey } from "../../src/keys";

// keys.ts is pure: routeCaptureKey + readKeyEventInput take POJO inputs.
// KeyEvent is a class in @opentui/core; tests build structural fakes covering
// only the fields keys.ts reads.

const keyEvent = (overrides: Partial<KeyEvent> & { name: string }): KeyEvent =>
  ({
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: "",
    number: false,
    raw: "",
    eventType: "press",
    source: "raw",
    ...overrides,
  }) as unknown as KeyEvent;

const tid = (value: string): CapturedTargetId => value as CapturedTargetId;

const target = (id: string): CapturedTarget =>
  ({
    id: tid(id),
    type: "BoxRenderable",
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    ancestry: ["Root"],
  }) as CapturedTarget;

const activeState = (overrides: Partial<CaptureModeState> = {}): CaptureModeState => ({
  ...initialState,
  active: true,
  targets: [target("a"), target("b")],
  currentIndex: 0,
  ...overrides,
});

const draftState = (): CaptureModeState => ({
  ...activeState(),
  instructionDraft: true,
});

describe("readKeyEventInput", () => {
  it("returns the bare key name when no modifiers are pressed", () => {
    expect(readKeyEventInput(keyEvent({ name: "a" }))).toBe("a");
  });

  it("prefixes ctrl modifier", () => {
    expect(readKeyEventInput(keyEvent({ name: "g", ctrl: true }))).toBe("ctrl+g");
  });

  it("prefixes meta from either event.meta or event.option", () => {
    expect(readKeyEventInput(keyEvent({ name: "x", meta: true }))).toBe("meta+x");
    expect(readKeyEventInput(keyEvent({ name: "x", option: true }))).toBe("meta+x");
  });

  it("prefixes shift modifier", () => {
    expect(readKeyEventInput(keyEvent({ name: "tab", shift: true }))).toBe("shift+tab");
  });

  it("combines modifiers in ctrl+meta+shift order", () => {
    expect(readKeyEventInput(keyEvent({ name: "s", ctrl: true, meta: true, shift: true }))).toBe(
      "ctrl+meta+shift+s",
    );
  });

  it("rewrites 'linefeed' to 'enter'", () => {
    expect(readKeyEventInput(keyEvent({ name: "linefeed" }))).toBe("enter");
  });

  it("normalises to lowercase and strips internal spaces", () => {
    expect(readKeyEventInput(keyEvent({ name: "Tab" }))).toBe("tab");
  });
});

describe("routeCaptureKey — instruction draft mode", () => {
  it("routes 'escape' to CancelDraft", () => {
    const route = routeCaptureKey({ state: draftState(), key: "escape" });
    expect(route).toEqual({ _tag: "Intent", intent: CaptureModeIntent.CancelDraft() });
  });

  it("routes 'esc' alias to CancelDraft", () => {
    const route = routeCaptureKey({ state: draftState(), key: "esc" });
    expect(route).toEqual({ _tag: "Intent", intent: CaptureModeIntent.CancelDraft() });
  });

  // The host hands every other key to the focused InputRenderable — enter is
  // committed via the input's own ENTER event, and the input owns word-delete,
  // paste, undo, etc. natively.
  it.each(["enter", "return", "backspace", "delete", "ctrl+w", "meta+backspace", "f1", "a"])(
    "returns undefined for '%s' so the focused input handles it natively",
    (key) => {
      expect(routeCaptureKey({ state: draftState(), key })).toBeUndefined();
    },
  );
});

describe("routeCaptureKey — inactive mode keybinding", () => {
  it("returns EnterMode for the default 'ctrl+g' keybinding", () => {
    expect(routeCaptureKey({ state: initialState, key: "ctrl+g" })).toEqual({ _tag: "EnterMode" });
  });

  it("respects a custom keybinding option (case-insensitive normalisation)", () => {
    const route = routeCaptureKey({
      state: initialState,
      key: "ctrl+k",
      keybinding: "Ctrl+K",
    });
    expect(route).toEqual({ _tag: "EnterMode" });
  });

  it("returns undefined for non-matching keys while inactive", () => {
    expect(routeCaptureKey({ state: initialState, key: "a" })).toBeUndefined();
    expect(routeCaptureKey({ state: initialState, key: "ctrl+x" })).toBeUndefined();
  });
});

describe("routeCaptureKey — active mode", () => {
  const state = activeState();

  it.each(["escape", "esc", "q"] as const)("routes %s to ExitMode", (key) => {
    expect(routeCaptureKey({ state, key })).toEqual({
      _tag: "Intent",
      intent: CaptureModeIntent.ExitMode(),
    });
  });

  it("routes 'a' to StartDraft", () => {
    expect(routeCaptureKey({ state, key: "a" })).toEqual({
      _tag: "Intent",
      intent: CaptureModeIntent.StartDraft(),
    });
  });

  it.each(["tab", "arrowdown", "arrowright", "down", "right", "j"] as const)(
    "routes %s to MoveSelection(next)",
    (key) => {
      expect(routeCaptureKey({ state, key })).toEqual({
        _tag: "Intent",
        intent: CaptureModeIntent.MoveSelection({ direction: "next" }),
      });
    },
  );

  it.each(["shift+tab", "arrowup", "arrowleft", "up", "left", "k"] as const)(
    "routes %s to MoveSelection(previous)",
    (key) => {
      expect(routeCaptureKey({ state, key })).toEqual({
        _tag: "Intent",
        intent: CaptureModeIntent.MoveSelection({ direction: "previous" }),
      });
    },
  );

  it.each([" ", "space", "enter", "return"] as const)("routes %s to ToggleCurrent", (key) => {
    expect(routeCaptureKey({ state, key })).toEqual({
      _tag: "Intent",
      intent: CaptureModeIntent.ToggleCurrent(),
    });
  });

  it.each(["backspace", "delete"] as const)("routes %s to DeselectCurrent", (key) => {
    expect(routeCaptureKey({ state, key })).toEqual({
      _tag: "Intent",
      intent: CaptureModeIntent.DeselectCurrent(),
    });
  });

  it("returns undefined for unmapped keys", () => {
    expect(routeCaptureKey({ state, key: "f1" })).toBeUndefined();
    expect(routeCaptureKey({ state, key: "ctrl+g" })).toBeUndefined();
  });
});
