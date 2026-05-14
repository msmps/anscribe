import type { CliRenderer } from "@opentui/core";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
  CaptureHostFailureReporter,
  type CaptureMetadataEnrichment,
  CaptureMode,
  CapturePersistence,
  CapturePersistenceError,
  type CaptureSink,
  formatCaptureForClipboard,
  readRegisteredCaptureSinks,
} from "@anscribe/core";
import { makeCaptureHostLayer } from "../capture-host";

// Internal install entry takes an enricher Layer so framework adapters can
// compose runtime-supplied enrichment without `Layer` showing up on the
// package's public surface. The vanilla `installCapture` in `../index.ts` is
// a thin wrapper around this.

export interface InstallCaptureOptions {
  readonly keybinding?: string;
  /** Hex color (e.g. "#ffd166") drawn over the target under the cursor. */
  readonly highlightColor?: string;
  /** Hex color drawn over each selected target. */
  readonly selectedColor?: string;
}

export interface CaptureInstallation {
  readonly dispose: () => void;
  readonly close: () => Promise<void>;
}

export function installCaptureWithEnrichment(
  renderer: CliRenderer,
  options: InstallCaptureOptions,
  enricherLayer: Layer.Layer<CaptureMetadataEnrichment>,
): CaptureInstallation {
  // Sinks are picked up from the module-scoped registry populated by
  // side-effect imports (e.g. `import "@anscribe/mcp/sink"`). Snapshotted at
  // host install time so adding/removing sinks later doesn't reach back into
  // an already-running renderer.
  const sinks = readRegisteredCaptureSinks();

  const composedLayer = makeCaptureHostLayer(renderer, options).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        CaptureMode.live,
        makeCompositePersistenceLayer(renderer, sinks),
        enricherLayer,
        CaptureHostFailureReporter.live,
      ),
    ),
  );
  const runtime = ManagedRuntime.make(composedLayer);
  runtime.runSync(Effect.void);

  return {
    close: () => runtime.dispose(),
    dispose() {
      void runtime.dispose().catch(() => undefined);
    },
  };
}

// Composite persistence: clipboard always fires first (synchronous, no
// failure channel), then each registered sink runs sequentially. Sink
// lifecycles are tied to the layer's scope — `close()` runs on ManagedRuntime
// disposal, so callers don't need to track individual sinks.
const makeCompositePersistenceLayer = (renderer: CliRenderer, sinks: ReadonlyArray<CaptureSink>) =>
  Layer.effect(
    CapturePersistence,
    Effect.gen(function* () {
      for (const sink of sinks) {
        const cleanup = sink.close;
        if (cleanup !== undefined) {
          yield* Effect.addFinalizer(() => Effect.promise(() => cleanup()).pipe(Effect.orDie));
        }
      }

      return CapturePersistence.of({
        createCapture: (capture) =>
          Effect.gen(function* () {
            // Clipboard always: writes to the renderer's OSC52 stream.
            // Pure sync — no failure channel to thread through.
            yield* Effect.sync(() => {
              renderer.copyToClipboardOSC52(formatCaptureForClipboard(capture));
            });

            // Sinks fan out sequentially in array order. First failure
            // short-circuits — the capture state machine has already
            // committed the row, and the host's failure reporter logs the
            // tagged sink name so the caller can identify which destination
            // failed.
            yield* Effect.forEach(
              sinks,
              (sink) =>
                Effect.tryPromise({
                  try: () => sink.write(capture),
                  catch: (cause) =>
                    new CapturePersistenceError({
                      message: `Anscribe sink "${sink.name}" failed to persist Capture`,
                      cause,
                    }),
                }),
              { discard: true },
            );
          }),
      });
    }),
  );
