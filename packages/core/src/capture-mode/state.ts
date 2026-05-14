import { Data } from "effect";
import type { CapturedTarget } from "../schema";
import {
  isPickerIntent,
  pickerTransition,
  selectCurrentTarget,
  type PickerIntent,
  type PickerState,
} from "../picker/state";

export interface CaptureModeState extends PickerState {
  // Presence-only flag. The draft body lives in the adapter's input renderable
  // (e.g. OpenTUI's InputRenderable) and is passed in on CommitDraft.
  readonly instructionDraft: boolean;
}

export const initialState: CaptureModeState = {
  active: false,
  targets: [],
  currentIndex: -1,
  selectedTargetIds: [],
  instructionDraft: false,
};

export type CaptureModeIntent = Data.TaggedEnum<{
  EnterMode: { readonly targets: readonly CapturedTarget[] };
  ExitMode: {};
  MoveSelection: { readonly direction: "next" | "previous" };
  DeselectCurrent: {};
  ToggleCurrent: {};
  SelectAtCell: { readonly x: number; readonly y: number };
  StartDraft: {};
  CommitDraft: { readonly body: string };
  CancelDraft: {};
}>;

export const CaptureModeIntent = Data.taggedEnum<CaptureModeIntent>();

type DraftIntent = Exclude<CaptureModeIntent, PickerIntent>;

export function transition(state: CaptureModeState, intent: CaptureModeIntent): CaptureModeState {
  if (isPickerIntent(intent)) {
    const next = pickerTransition(state, intent);
    // EnterMode and ExitMode in picker construct fresh state literals (no
    // `...state` spread), so the runtime object lacks `instructionDraft`.
    // Re-entry / exit must clear the draft anyway — explicit `false` keeps
    // the typed contract intact.
    if (intent._tag === "EnterMode" || intent._tag === "ExitMode") {
      return { ...next, instructionDraft: false };
    }
    // Other picker intents spread `state` — at runtime that carries
    // `instructionDraft` through.
    return next as CaptureModeState;
  }

  return draftTransition(state, intent as DraftIntent);
}

function draftTransition(state: CaptureModeState, intent: DraftIntent): CaptureModeState {
  switch (intent._tag) {
    case "StartDraft": {
      const currentTarget = selectCurrentTarget(state);

      if (currentTarget === undefined && state.selectedTargetIds.length === 0) {
        return state;
      }

      return { ...state, instructionDraft: true };
    }
    case "CommitDraft": {
      if (!state.instructionDraft) {
        return state;
      }

      const hasExplicitSelection = state.selectedTargetIds.length > 0;
      const willPersist = intent.body.trim().length > 0 && hasResolvedTargets(state);

      return {
        ...state,
        instructionDraft: false,
        selectedTargetIds: willPersist && hasExplicitSelection ? [] : state.selectedTargetIds,
      };
    }
    case "CancelDraft": {
      if (!state.instructionDraft) {
        return state;
      }

      return { ...state, instructionDraft: false };
    }
  }
}

function hasResolvedTargets(state: CaptureModeState): boolean {
  if (state.selectedTargetIds.length > 0) {
    return true;
  }

  return selectCurrentTarget(state) !== undefined;
}
