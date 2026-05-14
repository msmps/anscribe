import { Clock, Context, DateTime, Effect, Layer, SubscriptionRef } from "effect";
import {
  Capture,
  CapturedTarget,
  CapturePersistenceError,
  CaptureValidationError,
  decodeAnscribeDataEffect,
  generateCaptureId,
  generateCapturedTargetId,
  IsoTimestamp,
  makeCapture,
} from "../schema";
import { selectSelectedTargets } from "../picker/state";
import { initialState, transition, type CaptureModeIntent, type CaptureModeState } from "./state";

/**
 * Reported by host adapters when forwarding a `CaptureModeDispatchResult.toPersist`
 * Capture to its sink fails or when dispatch itself rejects the draft as invalid.
 */
export type CaptureModeDispatchError = CaptureValidationError | CapturePersistenceError;

export interface CaptureModeDispatchResult {
  readonly state: CaptureModeState;
  readonly toPersist?: Capture;
}

export class CapturePersistence extends Context.Service<
  CapturePersistence,
  {
    readonly createCapture: (capture: Capture) => Effect.Effect<void, CapturePersistenceError>;
  }
>()("anscribe/capture-mode/service/CapturePersistence") {}

/**
 * Host adapters route `CaptureModeDispatchError` here so the failure surfaces
 * as a structured log entry. The default reporter logs via `Effect.logError`;
 * tests override with `Layer.succeed(CaptureHostFailureReporter, ...)`.
 */
export class CaptureHostFailureReporter extends Context.Service<
  CaptureHostFailureReporter,
  { readonly report: (error: CaptureModeDispatchError) => Effect.Effect<void> }
>()("anscribe/capture-mode/service/CaptureHostFailureReporter") {
  static readonly live = Layer.succeed(
    this,
    this.of({
      report: Effect.fn("CaptureHostFailureReporter.report")((error: CaptureModeDispatchError) =>
        Effect.logError("Unable to persist Anscribe Capture", error),
      ),
    }),
  );
}

export class CaptureMode extends Context.Service<
  CaptureMode,
  {
    readonly dispatch: (
      intent: CaptureModeIntent,
    ) => Effect.Effect<CaptureModeDispatchResult, CaptureValidationError>;
    readonly current: () => Effect.Effect<CaptureModeState>;
  }
>()("anscribe/capture-mode/service/CaptureMode") {
  static readonly live = Layer.effect(
    CaptureMode,
    Effect.gen(function* () {
      const ref = yield* SubscriptionRef.make(initialState);

      return CaptureMode.of({
        dispatch: Effect.fn("CaptureMode.dispatch")(function* (intent) {
          if (intent._tag === "CommitDraft") {
            const previousState = yield* SubscriptionRef.get(ref);
            const state = yield* SubscriptionRef.updateAndGet(ref, (current) =>
              transition(current, intent),
            );
            const toPersist = yield* makeCommitDraftCapture(previousState, intent.body);

            return toPersist !== undefined ? { state, toPersist } : { state };
          }

          const state = yield* SubscriptionRef.updateAndGet(ref, (current) =>
            transition(current, intent),
          );

          return { state };
        }),
        current: () => SubscriptionRef.get(ref),
      });
    }),
  );
}

const makeCommitDraftCapture = (
  state: CaptureModeState,
  body: string,
): Effect.Effect<Capture | undefined, CaptureValidationError> =>
  Effect.gen(function* () {
    const trimmedBody = body.trim();
    const hasInstructionSource = !state.instructionDraft || trimmedBody.length > 0;

    if (!hasInstructionSource) {
      return undefined;
    }

    const selectedTargets = selectSelectedTargets(state);

    if (selectedTargets.length === 0) {
      return undefined;
    }

    const instruction = trimmedBody.length > 0 ? trimmedBody : undefined;
    const millis = yield* Clock.currentTimeMillis;
    const createdAt = DateTime.formatIso(DateTime.makeUnsafe(millis));
    const targets = yield* Effect.forEach(selectedTargets, (target) =>
      Effect.gen(function* () {
        const id = yield* generateCapturedTargetId;

        return yield* decodeAnscribeDataEffect(CapturedTarget, { ...target, id });
      }),
    );

    return yield* makeCapture({
      id: yield* generateCaptureId,
      createdAt: IsoTimestamp.make(createdAt),
      status: "pending",
      ...(instruction !== undefined && { instruction }),
      targets,
    });
  });
