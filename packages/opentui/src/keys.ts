import type { KeyEvent } from "@opentui/core";
import { CaptureModeIntent, type CaptureModeState } from "@anscribe/core";

type CaptureKeyRoute =
  | { readonly _tag: "EnterMode" }
  | { readonly _tag: "Intent"; readonly intent: CaptureModeIntent };

export function routeCaptureKey(input: {
  readonly state: CaptureModeState;
  readonly key: string;
  readonly keybinding?: string;
}): CaptureKeyRoute | undefined {
  const { state, key } = input;

  // In draft mode the host hands every keystroke to the focused
  // InputRenderable. We only intercept escape so the draft can be cancelled
  // without the input absorbing the key; enter is wired through the input's
  // own submit → ENTER event in the host.
  if (state.instructionDraft) {
    return key === "escape" || key === "esc"
      ? { _tag: "Intent", intent: CaptureModeIntent.CancelDraft() }
      : undefined;
  }

  if (!state.active && key === normalizeKey(input.keybinding ?? "ctrl+g")) {
    return { _tag: "EnterMode" };
  }

  if (!state.active) {
    return undefined;
  }

  const intent = mapActiveKey(key);

  return intent === undefined ? undefined : { _tag: "Intent", intent };
}

const EXIT_KEYS = new Set(["escape", "esc", "q"]);
const NEXT_KEYS = new Set(["tab", "arrowdown", "arrowright", "down", "right", "j"]);
const PREVIOUS_KEYS = new Set(["shift+tab", "arrowup", "arrowleft", "up", "left", "k"]);
const TOGGLE_KEYS = new Set([" ", "space", "enter", "return"]);
const DESELECT_KEYS = new Set(["backspace", "delete"]);

function mapActiveKey(key: string): CaptureModeIntent | undefined {
  if (EXIT_KEYS.has(key)) return CaptureModeIntent.ExitMode();
  if (key === "a") return CaptureModeIntent.StartDraft();
  if (NEXT_KEYS.has(key)) return CaptureModeIntent.MoveSelection({ direction: "next" });
  if (PREVIOUS_KEYS.has(key)) return CaptureModeIntent.MoveSelection({ direction: "previous" });
  if (TOGGLE_KEYS.has(key)) return CaptureModeIntent.ToggleCurrent();
  if (DESELECT_KEYS.has(key)) return CaptureModeIntent.DeselectCurrent();
  return undefined;
}

export function readKeyEventInput(event: KeyEvent): string {
  const parts = [];

  if (event.ctrl) parts.push("ctrl");
  if (event.meta || event.option) parts.push("meta");
  if (event.shift) parts.push("shift");
  parts.push(event.name === "linefeed" ? "enter" : event.name);

  return normalizeKey(parts.join("+"));
}

function normalizeKey(input: string): string {
  return input.trim().toLowerCase().replaceAll(" ", "");
}
