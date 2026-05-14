---
"@anscribe/core": minor
"@anscribe/mcp": minor
"@anscribe/opentui": minor
"@anscribe/react": minor
---

Move the `CaptureSink` registry into `@anscribe/core` and make `@anscribe/core` a peer dependency of every adapter package.

In `0.1.0`, the registry lived in `@anscribe/opentui` and `@anscribe/mcp` imported `registerCaptureSink` from `@anscribe/opentui/sinks`. Because `@anscribe/opentui` was not a dependency of `@anscribe/mcp`, tsdown bundled an inline copy of the registry into `@anscribe/mcp/sink`, leaving the published package with two separate `registeredSinks` Maps at runtime — `mcpSink()` would register into one, and `installCapture` would read from the other. Captures from any consumer using the published packages silently went nowhere.

The registry now lives in `@anscribe/core`, with all adapter packages depending on it as a peer so the singleton invariant survives any package-manager hoisting outcome. The `@anscribe/opentui/sinks` subpath has been removed — import `registerCaptureSink`, `readRegisteredCaptureSinks`, `resetCaptureSinks`, and `CaptureSink` from `@anscribe/core` instead.
