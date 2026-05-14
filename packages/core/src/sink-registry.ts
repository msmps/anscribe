import type { CaptureSink } from "./sinks";

// Module-level registry mutated by side-effect imports such as
// `@anscribe/mcp/sink`. Keyed by sink name so re-importing the same module is
// idempotent and so adapter authors don't have to track de-duplication
// themselves. Sinks come back out in insertion order to keep capture fan-out
// deterministic.
//
// Lives in `@anscribe/core` (not a host adapter) so a single `@anscribe/core`
// instance is the shared registry across `@anscribe/mcp`, `@anscribe/opentui`,
// and any future host adapter — declaring `@anscribe/core` as a peer of each
// adapter package keeps that singleton invariant.

const registeredSinks = new Map<string, CaptureSink>();

export const registerCaptureSink = (sink: CaptureSink): void => {
  registeredSinks.set(sink.name, sink);
};

export const readRegisteredCaptureSinks = (): ReadonlyArray<CaptureSink> =>
  Array.from(registeredSinks.values());

/**
 * Test-only escape hatch. Production code should never call this — the
 * registry is process-global so a stray reset between two consumers in the
 * same process would silently break the second one.
 */
export const resetCaptureSinks = (): void => {
  registeredSinks.clear();
};
