# @anscribe/core

## 1.0.1

## 1.0.0

### Minor Changes

- [`375dee5`](https://github.com/msmps/anscribe/commit/375dee5872789d8a09cde4d47512445740c4afd0) Thanks [@msmps](https://github.com/msmps)! - Move the `CaptureSink` registry into `@anscribe/core` and make `@anscribe/core` a peer dependency of every adapter package.

  In `0.1.0`, the registry lived in `@anscribe/opentui` and `@anscribe/mcp` imported `registerCaptureSink` from `@anscribe/opentui/sinks`. Because `@anscribe/opentui` was not a dependency of `@anscribe/mcp`, tsdown bundled an inline copy of the registry into `@anscribe/mcp/sink`, leaving the published package with two separate `registeredSinks` Maps at runtime — `mcpSink()` would register into one, and `installCapture` would read from the other. Captures from any consumer using the published packages silently went nowhere.

  The registry now lives in `@anscribe/core`, with all adapter packages depending on it as a peer so the singleton invariant survives any package-manager hoisting outcome. The `@anscribe/opentui/sinks` subpath has been removed — import `registerCaptureSink`, `readRegisteredCaptureSinks`, `resetCaptureSinks`, and `CaptureSink` from `@anscribe/core` instead.

## 0.1.0

### Minor Changes

- [`aa3e1f0`](https://github.com/msmps/anscribe/commit/aa3e1f0de138d627d147aadd453056dd3ac3573a) Thanks [@msmps](https://github.com/msmps)! - Initial public release of Anscribe — capture live UI from your OpenTUI app and hand it to an AI coding agent.

  - `@anscribe/opentui` — `installCapture` for OpenTUI Core apps, headless `<Anscribe />` component for OpenTUI React apps. Every committed Capture is copied to the system clipboard via OSC52 as a markdown payload.
  - `@anscribe/mcp` — opt-in SQLite Capture Store and `anscribe-mcp` stdio server. Add a single `import "@anscribe/mcp/sink"` to persist pending Captures and expose them to agents through `list_pending_captures` / `resolve_capture` MCP tools.
  - `@anscribe/react` — React DevTools enrichment substrate. Consumed by `@anscribe/opentui`; intended foundation for future React-tree TUI adapters.
  - `@anscribe/core` — internal capture model and sink registry. Not part of the public API; published as a workspace dependency.
