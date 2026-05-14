import { describe, expect, it } from "vitest";
import {
  CaptureModeIntent,
  type CaptureModeState,
  type CapturedTarget,
  type CapturedTargetId,
  initialState,
  resolveTargetAtCell,
  selectCurrentTarget,
  type TerminalCellBounds,
  transition,
} from "@anscribe/core";

// state.ts is pure: transition + selectCurrentTarget operate on plain values
// and a TaggedEnum intent. Private helpers (resolveTargetAtCell,
// addSelection, removeSelection, hasResolvedTargets) are exercised indirectly
// through transition.

const tid = (value: string): CapturedTargetId => value as CapturedTargetId;

const bounds = (x: number, y: number, width = 10, height = 1): TerminalCellBounds => ({
  x,
  y,
  width,
  height,
});

const target = (overrides: {
  id: string;
  type?: string;
  bounds?: TerminalCellBounds;
  ancestry?: ReadonlyArray<string>;
}): CapturedTarget =>
  ({
    id: tid(overrides.id),
    type: overrides.type ?? "BoxRenderable",
    bounds: overrides.bounds ?? bounds(0, 0),
    ancestry: overrides.ancestry ?? ["Root"],
  }) as CapturedTarget;

const activeWith = (
  targets: ReadonlyArray<CapturedTarget>,
  overrides: Partial<CaptureModeState> = {},
): CaptureModeState => ({
  active: true,
  targets,
  currentIndex: targets.length > 0 ? 0 : -1,
  selectedTargetIds: [],
  instructionDraft: false,
  ...overrides,
});

describe("selectCurrentTarget", () => {
  it("returns undefined when state is inactive", () => {
    const s = activeWith([target({ id: "a" })], { active: false });
    expect(selectCurrentTarget(s)).toBeUndefined();
  });

  it("returns undefined when currentIndex is -1", () => {
    const s = activeWith([target({ id: "a" })], { currentIndex: -1 });
    expect(selectCurrentTarget(s)).toBeUndefined();
  });

  it("returns the target at currentIndex when active and indexed", () => {
    const a = target({ id: "a" });
    const b = target({ id: "b" });
    const s = activeWith([a, b], { currentIndex: 1 });
    expect(selectCurrentTarget(s)).toBe(b);
  });
});

describe("transition — EnterMode", () => {
  it("activates with provided targets and leaves the cursor unset so nothing reads as 'current'", () => {
    const targets = [target({ id: "a" }), target({ id: "b" })];
    const next = transition(initialState, CaptureModeIntent.EnterMode({ targets }));
    expect(next.active).toBe(true);
    expect(next.targets).toEqual(targets);
    expect(next.currentIndex).toBe(-1);
    expect(next.selectedTargetIds).toEqual([]);
  });

  it("leaves currentIndex at -1 when entering with no targets", () => {
    const next = transition(initialState, CaptureModeIntent.EnterMode({ targets: [] }));
    expect(next.active).toBe(true);
    expect(next.currentIndex).toBe(-1);
  });

  it("discards an in-progress draft on re-entry", () => {
    const prior = activeWith([target({ id: "a" })], { instructionDraft: true });
    const next = transition(prior, CaptureModeIntent.EnterMode({ targets: [target({ id: "b" })] }));
    expect(next.instructionDraft).toBe(false);
  });
});

describe("transition — ExitMode", () => {
  it("deactivates, resets cursor, clears selection, but preserves targets", () => {
    const a = target({ id: "a" });
    const b = target({ id: "b" });
    const prior = activeWith([a, b], { selectedTargetIds: [tid("a")] });
    const next = transition(prior, CaptureModeIntent.ExitMode());
    expect(next.active).toBe(false);
    expect(next.targets).toEqual([a, b]);
    expect(next.currentIndex).toBe(-1);
    expect(next.selectedTargetIds).toEqual([]);
  });
});

describe("transition — MoveSelection", () => {
  const targets = [target({ id: "a" }), target({ id: "b" }), target({ id: "c" })];

  it("advances currentIndex with direction=next", () => {
    const prior = activeWith(targets, { currentIndex: 0 });
    const next = transition(prior, CaptureModeIntent.MoveSelection({ direction: "next" }));
    expect(next.currentIndex).toBe(1);
  });

  it("retreats currentIndex with direction=previous", () => {
    const prior = activeWith(targets, { currentIndex: 1 });
    const next = transition(prior, CaptureModeIntent.MoveSelection({ direction: "previous" }));
    expect(next.currentIndex).toBe(0);
  });

  it("wraps forward from last to first", () => {
    const prior = activeWith(targets, { currentIndex: 2 });
    const next = transition(prior, CaptureModeIntent.MoveSelection({ direction: "next" }));
    expect(next.currentIndex).toBe(0);
  });

  it("wraps backward from first to last", () => {
    const prior = activeWith(targets, { currentIndex: 0 });
    const next = transition(prior, CaptureModeIntent.MoveSelection({ direction: "previous" }));
    expect(next.currentIndex).toBe(2);
  });

  it("is a no-op when inactive", () => {
    const prior = activeWith(targets, { active: false, currentIndex: 0 });
    const next = transition(prior, CaptureModeIntent.MoveSelection({ direction: "next" }));
    expect(next).toBe(prior);
  });

  it("is a no-op when targets are empty", () => {
    const prior = activeWith([]);
    const next = transition(prior, CaptureModeIntent.MoveSelection({ direction: "next" }));
    expect(next).toBe(prior);
  });

  it("lands on the first target when next-ing from an unset cursor", () => {
    const prior = activeWith(targets, { currentIndex: -1 });
    const next = transition(prior, CaptureModeIntent.MoveSelection({ direction: "next" }));
    expect(next.currentIndex).toBe(0);
  });

  it("lands on the last target when previous-ing from an unset cursor", () => {
    const prior = activeWith(targets, { currentIndex: -1 });
    const next = transition(prior, CaptureModeIntent.MoveSelection({ direction: "previous" }));
    expect(next.currentIndex).toBe(2);
  });
});

describe("transition — DeselectCurrent", () => {
  it("removes the current target's id from selectedTargetIds", () => {
    const a = target({ id: "a" });
    const b = target({ id: "b" });
    const prior = activeWith([a, b], {
      currentIndex: 0,
      selectedTargetIds: [tid("a"), tid("b")],
    });
    const next = transition(prior, CaptureModeIntent.DeselectCurrent());
    expect(next.selectedTargetIds).toEqual([tid("b")]);
  });

  it("is a no-op when the current target is not in the selection", () => {
    const a = target({ id: "a" });
    const prior = activeWith([a], { selectedTargetIds: [tid("other")] });
    const next = transition(prior, CaptureModeIntent.DeselectCurrent());
    expect(next.selectedTargetIds).toEqual([tid("other")]);
  });

  it("is a no-op when there is no current target (inactive)", () => {
    const prior = activeWith([target({ id: "a" })], { active: false });
    const next = transition(prior, CaptureModeIntent.DeselectCurrent());
    expect(next).toBe(prior);
  });
});

describe("transition — ToggleCurrent", () => {
  it("adds the current target's id when absent from selection", () => {
    const a = target({ id: "a" });
    const prior = activeWith([a]);
    const next = transition(prior, CaptureModeIntent.ToggleCurrent());
    expect(next.selectedTargetIds).toEqual([tid("a")]);
  });

  it("removes the current target's id when present in selection", () => {
    const a = target({ id: "a" });
    const prior = activeWith([a], { selectedTargetIds: [tid("a")] });
    const next = transition(prior, CaptureModeIntent.ToggleCurrent());
    expect(next.selectedTargetIds).toEqual([]);
  });

  it("is a no-op when there is no current target", () => {
    const prior = activeWith([], { currentIndex: -1 });
    const next = transition(prior, CaptureModeIntent.ToggleCurrent());
    expect(next).toBe(prior);
  });

  it("does not duplicate an existing selection (idempotent add)", () => {
    const a = target({ id: "a" });
    const b = target({ id: "b" });
    const prior = activeWith([a, b], {
      currentIndex: 1,
      selectedTargetIds: [tid("b")],
    });
    const removed = transition(prior, CaptureModeIntent.ToggleCurrent());
    expect(removed.selectedTargetIds).toEqual([]);
    const readded = transition(removed, CaptureModeIntent.ToggleCurrent());
    expect(readded.selectedTargetIds).toEqual([tid("b")]);
  });
});

describe("resolveTargetAtCell", () => {
  it("returns undefined when no target contains the cell", () => {
    const a = target({ id: "a", bounds: bounds(0, 0, 5, 5) });
    expect(resolveTargetAtCell([a], 10, 10)).toBeUndefined();
  });

  it("returns the deepest containing target by ancestry length", () => {
    const root = target({ id: "root", bounds: bounds(0, 0, 20, 20), ancestry: ["Root"] });
    const middle = target({
      id: "middle",
      bounds: bounds(0, 0, 20, 20),
      ancestry: ["Root", "Middle"],
    });
    const leaf = target({
      id: "leaf",
      bounds: bounds(0, 0, 20, 20),
      ancestry: ["Root", "Middle", "Leaf"],
    });
    expect(resolveTargetAtCell([root, middle, leaf], 5, 5)).toBe(leaf);
  });

  it("returns undefined for an empty target list", () => {
    expect(resolveTargetAtCell([], 0, 0)).toBeUndefined();
  });
});

describe("transition — SelectAtCell", () => {
  it("is a no-op when inactive", () => {
    const prior = activeWith([target({ id: "a", bounds: bounds(0, 0, 10, 10) })], {
      active: false,
    });
    const next = transition(prior, CaptureModeIntent.SelectAtCell({ x: 1, y: 1 }));
    expect(next).toBe(prior);
  });

  it("is a no-op when no target contains the cell", () => {
    const prior = activeWith([target({ id: "a", bounds: bounds(0, 0, 5, 5) })]);
    const next = transition(prior, CaptureModeIntent.SelectAtCell({ x: 10, y: 10 }));
    expect(next).toBe(prior);
  });

  it("selects the deepest containing target by ancestry length", () => {
    const root = target({
      id: "root",
      bounds: bounds(0, 0, 20, 20),
      ancestry: ["Root"],
    });
    const middle = target({
      id: "middle",
      bounds: bounds(0, 0, 20, 20),
      ancestry: ["Root", "Middle"],
    });
    const leaf = target({
      id: "leaf",
      bounds: bounds(0, 0, 20, 20),
      ancestry: ["Root", "Middle", "Leaf"],
    });
    const prior = activeWith([root, middle, leaf]);
    const next = transition(prior, CaptureModeIntent.SelectAtCell({ x: 5, y: 5 }));
    expect(next.selectedTargetIds).toEqual([tid("leaf")]);
    expect(next.currentIndex).toBe(2);
  });

  it("selects the deepest text-like child rather than its container", () => {
    const container = target({
      id: "container",
      type: "BoxRenderable",
      bounds: bounds(0, 0, 20, 20),
      ancestry: ["Root", "BoxRenderable"],
    });
    const textLeaf = target({
      id: "text-leaf",
      type: "TextRenderable",
      bounds: bounds(0, 0, 20, 20),
      ancestry: ["Root", "BoxRenderable", "TextRenderable"],
    });
    const prior = activeWith([container, textLeaf]);
    const next = transition(prior, CaptureModeIntent.SelectAtCell({ x: 5, y: 5 }));
    expect(next.selectedTargetIds).toEqual([tid("text-leaf")]);
    expect(next.currentIndex).toBe(1);
  });

  it("toggles selection off when the resolved target is already selected", () => {
    const prior = activeWith([target({ id: "a", bounds: bounds(0, 0, 10, 10) })], {
      selectedTargetIds: [tid("a")],
    });
    const next = transition(prior, CaptureModeIntent.SelectAtCell({ x: 1, y: 1 }));
    expect(next.selectedTargetIds).toEqual([]);
    expect(next.currentIndex).toBe(0);
  });
});

describe("transition — StartDraft", () => {
  it("flips instructionDraft on when a current target exists", () => {
    const prior = activeWith([target({ id: "a" })]);
    const next = transition(prior, CaptureModeIntent.StartDraft());
    expect(next.instructionDraft).toBe(true);
  });

  it("flips instructionDraft on when there is an explicit selection but no current target", () => {
    const prior = activeWith([target({ id: "a" })], {
      currentIndex: -1,
      selectedTargetIds: [tid("a")],
    });
    const next = transition(prior, CaptureModeIntent.StartDraft());
    expect(next.instructionDraft).toBe(true);
  });

  it("is a no-op when there are no targets and no selection", () => {
    const prior = activeWith([]);
    const next = transition(prior, CaptureModeIntent.StartDraft());
    expect(next).toBe(prior);
  });
});

describe("transition — CommitDraft", () => {
  it("clears the draft and keeps selection when body is blank (won't persist)", () => {
    const prior = activeWith([target({ id: "a" })], {
      selectedTargetIds: [tid("a")],
      instructionDraft: true,
    });
    const next = transition(prior, CaptureModeIntent.CommitDraft({ body: "   " }));
    expect(next.instructionDraft).toBe(false);
    expect(next.selectedTargetIds).toEqual([tid("a")]);
  });

  it("clears the draft and clears explicit selection when body persists", () => {
    const prior = activeWith([target({ id: "a" })], {
      selectedTargetIds: [tid("a")],
      instructionDraft: true,
    });
    const next = transition(prior, CaptureModeIntent.CommitDraft({ body: "fix" }));
    expect(next.instructionDraft).toBe(false);
    expect(next.selectedTargetIds).toEqual([]);
  });

  it("keeps an empty selection when persisting via current-target fallback", () => {
    const prior = activeWith([target({ id: "a" })], { instructionDraft: true });
    const next = transition(prior, CaptureModeIntent.CommitDraft({ body: "note" }));
    expect(next.instructionDraft).toBe(false);
    expect(next.selectedTargetIds).toEqual([]);
  });

  it("clears explicit selection ids even when none of them map to current targets", () => {
    // hasResolvedTargets short-circuits on selectedTargetIds.length > 0 without
    // verifying that those ids exist in state.targets, so willPersist=true and
    // the selection is cleared. service.ts re-validates ids against state.targets
    // before forming a Capture, so this stale state never reaches persistence.
    const prior: CaptureModeState = {
      active: true,
      targets: [],
      currentIndex: -1,
      selectedTargetIds: [tid("stale")],
      instructionDraft: true,
    };
    const next = transition(prior, CaptureModeIntent.CommitDraft({ body: "note" }));
    expect(next.instructionDraft).toBe(false);
    expect(next.selectedTargetIds).toEqual([]);
  });

  it("is a no-op when no draft is open", () => {
    const prior = activeWith([target({ id: "a" })]);
    const next = transition(prior, CaptureModeIntent.CommitDraft({ body: "note" }));
    expect(next).toBe(prior);
  });
});

describe("transition — CancelDraft", () => {
  it("clears the draft and preserves everything else", () => {
    const prior = activeWith([target({ id: "a" })], {
      selectedTargetIds: [tid("a")],
      instructionDraft: true,
    });
    const next = transition(prior, CaptureModeIntent.CancelDraft());
    expect(next.instructionDraft).toBe(false);
    expect(next.selectedTargetIds).toEqual([tid("a")]);
  });

  it("is a no-op when no draft is open", () => {
    const prior = activeWith([target({ id: "a" })]);
    const next = transition(prior, CaptureModeIntent.CancelDraft());
    expect(next).toBe(prior);
  });
});
