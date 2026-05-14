import type { Capture } from "./schema";

/**
 * A destination that committed Captures are written to.
 *
 * Host adapters (e.g. `installCapture` in `@anscribe/opentui`) always write
 * every committed Capture to the system clipboard via OSC52 first, then fan
 * out to any user-supplied sinks in order. A sink encapsulates whatever
 * resources its writes need — the host calls `close()` on shutdown so the
 * sink can release them.
 *
 * Sinks are constructed by factories exposed from the package that owns the
 * destination — see `mcpSink()` from `@anscribe/mcp` for the canonical
 * example. Authors of new sinks can implement this interface directly.
 *
 * Sink `write` is allowed to throw or reject; the host wraps the failure in
 * a `CapturePersistenceError` tagged with the sink's `name` and routes it
 * through `CaptureHostFailureReporter`. A failing sink does not roll back
 * earlier sinks' writes or the clipboard handoff.
 */
export interface CaptureSink {
  /**
   * Identifier surfaced in failure messages (e.g. `"anscribe-mcp"`). Should
   * be stable across instances; the React adapter uses the name set to gate
   * `useEffect` reinitialisation when sink instances change between renders.
   */
  readonly name: string;
  /** Persist a Capture. Called once per committed Capture, in array order. */
  readonly write: (capture: Capture) => Promise<void>;
  /** Optional cleanup. Called by the host on `dispose()` / `close()`. */
  readonly close?: () => Promise<void>;
}
