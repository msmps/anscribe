# @anscribe/opentui

## 0.1.0

### Minor Changes

- [`aa3e1f0`](https://github.com/msmps/anscribe/commit/aa3e1f0de138d627d147aadd453056dd3ac3573a) Thanks [@msmps](https://github.com/msmps)! - Initial public release of Anscribe — capture live UI from your OpenTUI app and hand it to an AI coding agent.

  - `@anscribe/opentui` — `installCapture` for OpenTUI Core apps, headless `<Anscribe />` component for OpenTUI React apps. Every committed Capture is copied to the system clipboard via OSC52 as a markdown payload.
  - `@anscribe/mcp` — opt-in SQLite Capture Store and `anscribe-mcp` stdio server. Add a single `import "@anscribe/mcp/sink"` to persist pending Captures and expose them to agents through `list_pending_captures` / `resolve_capture` MCP tools.
  - `@anscribe/react` — React DevTools enrichment substrate. Consumed by `@anscribe/opentui`; intended foundation for future React-tree TUI adapters.
  - `@anscribe/core` — internal capture model and sink registry. Not part of the public API; published as a workspace dependency.

### Patch Changes

- Updated dependencies [[`aa3e1f0`](https://github.com/msmps/anscribe/commit/aa3e1f0de138d627d147aadd453056dd3ac3573a)]:
  - @anscribe/core@0.1.0
  - @anscribe/react@0.1.0
