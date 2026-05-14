# @anscribe/mcp

> SQLite-backed Capture Store + `anscribe-mcp` stdio server. Lets AI coding agents pull pending Anscribe Captures and resolve them.

Used with [`@anscribe/opentui`](https://www.npmjs.com/package/@anscribe/opentui) when you want agents to pull pending Captures from a project-local queue. Clipboard handoff still happens — the MCP sink is additive.

## Install

```bash
bun add @anscribe/mcp
```

Then add a single side-effect import at the top of your entry file:

```ts
import "@anscribe/mcp/sink";

import { installCapture } from "@anscribe/opentui";
import { createCliRenderer } from "@opentui/core";

const renderer = await createCliRenderer({ useMouse: true });
installCapture(renderer, { keybinding: "ctrl+g" });
```

```tsx
import "@anscribe/opentui/react/preload";
import "@anscribe/mcp/sink";

import { Anscribe } from "@anscribe/opentui/react";

<Anscribe keybinding="ctrl+g" />
```

The side-effect import registers the SQLite Capture Store sink in `@anscribe/core`'s shared sink registry before `installCapture` snapshots it. On first capture commit, Anscribe opens a project-local Capture Store at `<project>/.anscribe/captures.sqlite` and writes a `<project>/.anscribe/.gitignore` so the directory is auto-protected. An existing `.gitignore` is preserved untouched.

### Custom project root

For tests, multi-tenant runners, or any setup where `process.cwd()` isn't the right anchor, register the sink programmatically with an explicit `projectRoot`:

```ts
import { registerCaptureSink } from "@anscribe/core";
import { mcpSink } from "@anscribe/mcp";

registerCaptureSink(mcpSink({ projectRoot: "/path/to/project" }));
```

This mirrors the `anscribe-mcp` bin's `--project` flag — both walk up from the supplied path to find a `.git` or workspace marker, then open the store under `.anscribe/captures.sqlite`.

## Register the server with your agent

The `anscribe-mcp` binary speaks MCP over stdio.

The easiest cross-agent path is [`add-mcp`](https://github.com/neondatabase/add-mcp), which auto-detects installed agents (Claude Code, Cursor, Codex, Windsurf, opencode, and others) and patches their config files:

```bash
npx add-mcp @anscribe/mcp
```

Or configure manually. The exact shape depends on your agent — examples:

**Claude Code** (`~/.claude.json`):

```json
{
  "mcpServers": {
    "anscribe": {
      "command": "anscribe-mcp"
    }
  }
}
```

**Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "anscribe": {
      "command": "anscribe-mcp"
    }
  }
}
```

## Project resolution

`anscribe-mcp` reads pending Captures from a project-local `.anscribe/captures.sqlite`. The project root is resolved in this order:

1. `--project <path>` CLI flag (highest precedence)
2. `ANSCRIBE_PROJECT_ROOT` environment variable
3. `process.cwd()` (default)

On startup the server logs the resolved paths to stderr so you can confirm which store is in use:

```
anscribe-mcp: project root = /Users/you/projects/my-tui
anscribe-mcp: store        = /Users/you/projects/my-tui/.anscribe/captures.sqlite
```

If the resolved path doesn't exist, the server fails fast with a typed error before MCP initialization.

Most agents launch MCP servers from the project directory, so the default works without flags. Override when you need to point at a different workspace (e.g. a long-running global server, a CI runner, or a sandboxed environment).

## MCP tools

| Tool | Description |
|---|---|
| `list_pending_captures` | Return pending Captures with developer instructions and selected targets. Each target carries type, terminal-cell bounds, ancestry, visible content, optional runtime metadata (`componentName`, `componentPath`, `identifier`), and optional source references. |
| `resolve_capture` | Mark a Capture resolved. Takes `{ captureId: string }`. |

The store is append-only-by-status: resolving a Capture flips its status but preserves the row. Use the store directly via the `CaptureStore` service if you need to query resolved Captures from your own tooling.

## Programmatic use

```ts
import {
  CaptureStore,
  makeCaptureStorePersistence,
  mcpSink,
  runAnscribeMcpServer,
} from "@anscribe/mcp";
```

- `mcpSink({ projectRoot? })` — the sink factory used by `@anscribe/mcp/sink` under the hood. Pair with `registerCaptureSink` from `@anscribe/core` for dynamic registration.
- `CaptureStore.live` — `Context.Service` layer pointing at `process.cwd()/.anscribe/captures.sqlite`.
- `CaptureStore.layer({ projectRoot })` — factory variant; resolves the store path against an explicit project root.
- `makeCaptureStorePersistence({ projectRoot? })` — lower-level vanilla `{ write, close }` writer used internally by `mcpSink`. Useful if you're wiring your own sink wrapper.
- `runAnscribeMcpServer({ name?, version?, transport? })` — Effect-returning MCP server bootstrap. Defaults to `StdioServerTransport`.

## License

MIT © [msmps](https://github.com/msmps)
