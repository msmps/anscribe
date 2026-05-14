import { type Capture } from "@anscribe/core";
import { Effect, ManagedRuntime } from "effect";
import { CaptureStore, type CaptureStoreLayerOptions } from "./store";

export interface CaptureStorePersistence {
  readonly write: (capture: Capture) => Promise<void>;
  readonly close: () => Promise<void>;
}

/**
 * Lower-level primitive: build a vanilla Promise-based writer + closer over a
 * project-local `CaptureStore`. Most users want `mcpSink()` instead — it wraps
 * this with the `CaptureSink` shape that `installCapture` expects.
 *
 * `options.projectRoot` mirrors the `--project` / `ANSCRIBE_PROJECT_ROOT`
 * resolution used by the `anscribe-mcp` bin: provide an explicit path to
 * override the default `process.cwd()` walk.
 */
export const makeCaptureStorePersistence = (
  options: CaptureStoreLayerOptions = {},
): CaptureStorePersistence => {
  const runtime = ManagedRuntime.make(
    options.projectRoot === undefined ? CaptureStore.live : CaptureStore.layer(options),
  );

  return {
    write: (capture) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const store = yield* CaptureStore;
          yield* store.createCapture(capture);
        }),
      ),
    close: () => runtime.dispose(),
  };
};
