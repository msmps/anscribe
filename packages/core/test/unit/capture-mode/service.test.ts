import { describe, expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import {
  type Capture,
  CapturedTarget,
  CapturedTargetId,
  CaptureMetadata,
  CaptureMode,
  CaptureModeIntent,
  TerminalCellBounds,
} from "@anscribe/core";

const TestLayer = CaptureMode.live;

const bounds = (x: number, y: number) => new TerminalCellBounds({ x, y, width: 10, height: 1 });

const makeTarget = (
  id: string,
  overrides: {
    bounds?: TerminalCellBounds;
    ancestry?: ReadonlyArray<string>;
    metadata?: CaptureMetadata;
  } = {},
) =>
  new CapturedTarget({
    id: CapturedTargetId.make(id),
    type: "BoxRenderable",
    bounds: overrides.bounds ?? bounds(0, 0),
    ancestry: overrides.ancestry ?? ["root"],
    ...(overrides.metadata !== undefined && { metadata: overrides.metadata }),
  });

const dispatchAll = (intents: ReadonlyArray<CaptureModeIntent>) =>
  Effect.gen(function* () {
    const captureMode = yield* CaptureMode;
    let lastState = yield* captureMode.current();
    const captured: Capture[] = [];
    for (const intent of intents) {
      const result = yield* captureMode.dispatch(intent);
      lastState = result.state;
      if (result.toPersist !== undefined) {
        captured.push(result.toPersist);
      }
    }

    return { state: lastState, captured };
  });

describe("CaptureMode", () => {
  layer(TestLayer)("initial state is inactive with no targets", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const captureMode = yield* CaptureMode;
        const state = yield* captureMode.current();
        expect(state.active).toBe(false);
        expect(state.targets).toEqual([]);
        expect(state.currentIndex).toBe(-1);
        expect(state.selectedTargetIds).toEqual([]);
        expect(state.instructionDraft).toBe(false);
      }),
    );
  });

  layer(TestLayer)("EnterMode populates targets and leaves the cursor unset", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const targets = [makeTarget("a"), makeTarget("b"), makeTarget("c")];
        const { state, captured } = yield* dispatchAll([CaptureModeIntent.EnterMode({ targets })]);
        expect(state.active).toBe(true);
        expect(state.targets).toEqual(targets);
        expect(state.currentIndex).toBe(-1);
        expect(state.selectedTargetIds).toEqual([]);
        expect(captured).toEqual([]);
      }),
    );
  });

  layer(TestLayer)("MoveSelection cycles through targets from an unset cursor", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const targets = [makeTarget("a"), makeTarget("b"), makeTarget("c")];
        const { state } = yield* dispatchAll([
          CaptureModeIntent.EnterMode({ targets }),
          CaptureModeIntent.MoveSelection({ direction: "next" }),
          CaptureModeIntent.MoveSelection({ direction: "next" }),
          CaptureModeIntent.MoveSelection({ direction: "next" }),
          CaptureModeIntent.MoveSelection({ direction: "next" }),
        ]);
        expect(state.currentIndex).toBe(0); // -1 → 0 → 1 → 2 → wrap to 0
      }),
    );
  });

  layer(TestLayer)("ToggleCurrent adds/removes from selection once a cursor is set", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const targets = [makeTarget("a"), makeTarget("b")];
        const { state: afterAdd } = yield* dispatchAll([
          CaptureModeIntent.EnterMode({ targets }),
          CaptureModeIntent.MoveSelection({ direction: "next" }),
          CaptureModeIntent.ToggleCurrent(),
        ]);
        expect(afterAdd.selectedTargetIds).toEqual([CapturedTargetId.make("a")]);

        const { state: afterRemove } = yield* dispatchAll([
          CaptureModeIntent.EnterMode({ targets }),
          CaptureModeIntent.MoveSelection({ direction: "next" }),
          CaptureModeIntent.ToggleCurrent(),
          CaptureModeIntent.ToggleCurrent(),
        ]);
        expect(afterRemove.selectedTargetIds).toEqual([]);
      }),
    );
  });

  layer(TestLayer)(
    "CommitDraft with body + selected targets persists capture with instruction",
    (it) => {
      it.effect("runs", () =>
        Effect.gen(function* () {
          const targets = [makeTarget("a"), makeTarget("b")];
          const { state, captured } = yield* dispatchAll([
            CaptureModeIntent.EnterMode({ targets }),
            CaptureModeIntent.MoveSelection({ direction: "next" }),
            CaptureModeIntent.ToggleCurrent(),
            CaptureModeIntent.StartDraft(),
            CaptureModeIntent.CommitDraft({ body: "  fix this row  " }),
          ]);
          expect(state.instructionDraft).toBe(false);
          expect(state.selectedTargetIds).toEqual([]);
          expect(captured).toHaveLength(1);
          expect(captured[0]?.instruction).toBe("fix this row");
          expect(captured[0]?.targets).toHaveLength(1);
          expect(captured[0]?.targets[0]?.type).toBe("BoxRenderable");
          expect(captured[0]?.status).toBe("pending");
          expect(captured[0]?.id).toMatch(/.+/);
          expect(captured[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        }),
      );
    },
  );

  layer(TestLayer)("CommitDraft with active draft but empty body does not persist", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const targets = [makeTarget("a")];
        const { captured } = yield* dispatchAll([
          CaptureModeIntent.EnterMode({ targets }),
          CaptureModeIntent.MoveSelection({ direction: "next" }),
          CaptureModeIntent.ToggleCurrent(),
          CaptureModeIntent.StartDraft(),
          CaptureModeIntent.CommitDraft({ body: "" }),
        ]);
        expect(captured).toEqual([]);
      }),
    );
  });

  layer(TestLayer)(
    "CommitDraft without any prior draft but with selection persists capture without instruction",
    (it) => {
      it.effect("runs", () =>
        Effect.gen(function* () {
          const targets = [makeTarget("a")];
          const { captured } = yield* dispatchAll([
            CaptureModeIntent.EnterMode({ targets }),
            CaptureModeIntent.MoveSelection({ direction: "next" }),
            CaptureModeIntent.ToggleCurrent(),
            CaptureModeIntent.CommitDraft({ body: "" }),
          ]);
          expect(captured).toHaveLength(1);
          expect(captured[0]?.instruction).toBeUndefined();
          expect(captured[0]?.targets).toHaveLength(1);
        }),
      );
    },
  );

  layer(TestLayer)(
    "CommitDraft with body + no explicit selection persists current target",
    (it) => {
      it.effect("runs", () =>
        Effect.gen(function* () {
          const targets = [makeTarget("a"), makeTarget("b")];
          const { state, captured } = yield* dispatchAll([
            CaptureModeIntent.EnterMode({ targets }),
            CaptureModeIntent.MoveSelection({ direction: "next" }),
            CaptureModeIntent.StartDraft(),
            CaptureModeIntent.CommitDraft({ body: "note" }),
          ]);
          expect(state.selectedTargetIds).toEqual([]); // current-target path, no explicit selection
          expect(captured).toHaveLength(1);
          expect(captured[0]?.targets).toHaveLength(1);
          expect(captured[0]?.targets[0]?.type).toBe("BoxRenderable");
          expect(captured[0]?.instruction).toBe("note");
        }),
      );
    },
  );

  layer(TestLayer)("CommitDraft with body but no resolvable targets does not persist", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const { captured } = yield* dispatchAll([
          CaptureModeIntent.EnterMode({ targets: [] }),
          CaptureModeIntent.StartDraft(),
          CaptureModeIntent.CommitDraft({ body: "lonely" }),
        ]);
        expect(captured).toEqual([]);
      }),
    );
  });

  layer(TestLayer)(
    "CommitDraft with active draft but whitespace-only body does not persist",
    (it) => {
      it.effect("runs", () =>
        Effect.gen(function* () {
          const targets = [makeTarget("a")];
          const { captured } = yield* dispatchAll([
            CaptureModeIntent.EnterMode({ targets }),
            CaptureModeIntent.MoveSelection({ direction: "next" }),
            CaptureModeIntent.StartDraft(),
            CaptureModeIntent.CommitDraft({ body: "   " }),
          ]);
          expect(captured).toEqual([]);
        }),
      );
    },
  );

  layer(TestLayer)("non-CommitDraft intents never persist", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const targets = [makeTarget("a")];
        const { captured } = yield* dispatchAll([
          CaptureModeIntent.EnterMode({ targets }),
          CaptureModeIntent.MoveSelection({ direction: "next" }),
          CaptureModeIntent.ToggleCurrent(),
          CaptureModeIntent.DeselectCurrent(),
          CaptureModeIntent.StartDraft(),
          CaptureModeIntent.CancelDraft(),
          CaptureModeIntent.ExitMode(),
        ]);
        expect(captured).toEqual([]);
      }),
    );
  });
});
