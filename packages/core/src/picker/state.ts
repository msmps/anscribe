import { Data } from "effect";
import type { CapturedTarget, CapturedTargetId, TerminalCellBounds } from "../schema";

// Picker is the renderer-agnostic target-selection primitive that
// Capture Mode composes. It owns the active flag, the captured target
// list, the cursor index, and the multi-select set — nothing else.
// Anything workflow-specific (instruction drafts, persistence) lives
// in the consuming module.

export interface PickerState {
  readonly active: boolean;
  readonly targets: readonly CapturedTarget[];
  readonly currentIndex: number;
  readonly selectedTargetIds: readonly CapturedTargetId[];
}

export type PickerIntent = Data.TaggedEnum<{
  EnterMode: { readonly targets: readonly CapturedTarget[] };
  ExitMode: {};
  MoveSelection: { readonly direction: "next" | "previous" };
  DeselectCurrent: {};
  ToggleCurrent: {};
  SelectAtCell: { readonly x: number; readonly y: number };
}>;

export const PickerIntent = Data.taggedEnum<PickerIntent>();

const PICKER_INTENT_TAGS = new Set<PickerIntent["_tag"]>([
  "EnterMode",
  "ExitMode",
  "MoveSelection",
  "DeselectCurrent",
  "ToggleCurrent",
  "SelectAtCell",
]);

export function isPickerIntent(intent: { readonly _tag: string }): intent is PickerIntent {
  return PICKER_INTENT_TAGS.has(intent._tag as PickerIntent["_tag"]);
}

export function pickerTransition(state: PickerState, intent: PickerIntent): PickerState {
  return PickerIntent.$match(intent, {
    EnterMode: ({ targets }) => ({
      active: true,
      targets,
      currentIndex: -1,
      selectedTargetIds: [],
    }),
    ExitMode: () => ({
      active: false,
      targets: state.targets,
      currentIndex: -1,
      selectedTargetIds: [],
    }),
    MoveSelection: ({ direction }) => {
      if (!state.active || state.targets.length === 0) {
        return state;
      }

      const length = state.targets.length;
      const nextIndex = computeNextIndex(state.currentIndex, length, direction);

      return { ...state, currentIndex: nextIndex };
    },
    DeselectCurrent: () => {
      const currentTarget = selectCurrentTarget(state);

      if (currentTarget === undefined) {
        return state;
      }

      return {
        ...state,
        selectedTargetIds: removeSelection(state.selectedTargetIds, currentTarget.id),
      };
    },
    ToggleCurrent: () => {
      const currentTarget = selectCurrentTarget(state);

      if (currentTarget === undefined) {
        return state;
      }

      return {
        ...state,
        selectedTargetIds: state.selectedTargetIds.includes(currentTarget.id)
          ? removeSelection(state.selectedTargetIds, currentTarget.id)
          : addSelection(state.selectedTargetIds, currentTarget.id),
      };
    },
    SelectAtCell: ({ x, y }) => {
      if (!state.active) {
        return state;
      }

      const target = resolveTargetAtCell(state.targets, x, y);

      if (target === undefined) {
        return state;
      }

      const nextIndex = state.targets.findIndex((candidate) => candidate.id === target.id);

      return {
        ...state,
        currentIndex: nextIndex,
        selectedTargetIds: state.selectedTargetIds.includes(target.id)
          ? removeSelection(state.selectedTargetIds, target.id)
          : addSelection(state.selectedTargetIds, target.id),
      };
    },
  });
}

export function selectCurrentTarget(state: PickerState): CapturedTarget | undefined {
  return state.active && state.currentIndex >= 0 ? state.targets[state.currentIndex] : undefined;
}

export function selectSelectedTargets(state: PickerState): readonly CapturedTarget[] {
  if (state.selectedTargetIds.length > 0) {
    return state.selectedTargetIds
      .map((id) => state.targets.find((target) => target.id === id))
      .filter((target): target is CapturedTarget => target !== undefined);
  }

  const currentTarget = selectCurrentTarget(state);
  return currentTarget !== undefined ? [currentTarget] : [];
}

export function resolveTargetAtCell(
  targets: readonly CapturedTarget[],
  x: number,
  y: number,
): CapturedTarget | undefined {
  return targets
    .filter((target) => containsCell(target.bounds, x, y))
    .toSorted((a, b) => b.ancestry.length - a.ancestry.length)[0];
}

function computeNextIndex(
  currentIndex: number,
  length: number,
  direction: "next" | "previous",
): number {
  if (currentIndex < 0) {
    return direction === "next" ? 0 : length - 1;
  }
  return direction === "next" ? (currentIndex + 1) % length : (currentIndex - 1 + length) % length;
}

function containsCell(bounds: TerminalCellBounds, x: number, y: number): boolean {
  return (
    x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height
  );
}

function addSelection(
  existing: readonly CapturedTargetId[],
  id: CapturedTargetId,
): readonly CapturedTargetId[] {
  return existing.includes(id) ? existing : [...existing, id];
}

function removeSelection(
  existing: readonly CapturedTargetId[],
  id: CapturedTargetId,
): readonly CapturedTargetId[] {
  const next = existing.filter((candidate) => candidate !== id);

  return next.length === existing.length ? existing : next;
}
