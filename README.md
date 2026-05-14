# anscribe

> Capture live UI from your terminal app and hand it to an agent. Clipboard by default, opt-in MCP queue.

Anscribe lets you press a keybinding inside an [OpenTUI](https://github.com/sst/opentui) app, point at the live UI, type an instruction, and ship the resulting Capture to your agent — either by pasting from the clipboard or by letting the agent pull it through a local MCP server.

```ts
import { installCapture } from "@anscribe/opentui";
import { createCliRenderer } from "@opentui/core";

const renderer = await createCliRenderer({ useMouse: true });

installCapture(renderer, { keybinding: "ctrl+g" });
```

That's the whole setup. Press `ctrl+g`, select a renderable, press `a` to add an instruction, press `enter` to commit. The Capture lands on the system clipboard as a markdown payload — zero configuration, zero filesystem footprint.

Clipboard mode writes via [OSC52](https://chromium.googlesource.com/apps/libapps/+/master/hterm/doc/ControlSequences.md#OSC-52), so it works over SSH, inside dev containers, and on terminals without native bindings or permission prompts.

## Install

```bash
bun add @anscribe/opentui
```

For the agent-pull loop (persistent queue + MCP server):

```bash
bun add @anscribe/mcp
```

## Two modes

**Clipboard (default).** Commit a Capture and it lands on the system clipboard as markdown. Paste into Claude Code, Cursor, opencode, or anywhere else. No daemon, no filesystem footprint.

**MCP (opt-in).** Install `@anscribe/mcp`, add `import "@anscribe/mcp/sink"` at the top of your entry file, and register the `anscribe-mcp` stdio server with your agent. Captures still land on the clipboard *and* in a project-local SQLite store at `.anscribe/captures.sqlite`; agents pull pending Captures and resolve them through MCP tools. See [`@anscribe/mcp`](packages/mcp) for setup.

## Packages

| Package | Purpose |
|---|---|
| [`@anscribe/opentui`](packages/opentui) | `installCapture` for OpenTUI Core apps + headless `<Anscribe />` React component |
| [`@anscribe/react`](packages/react) | Cross-framework React DevTools enrichment (consumed by OpenTUI; intended substrate for future React-tree TUI adapters) |
| [`@anscribe/mcp`](packages/mcp) | SQLite Capture Store + `anscribe-mcp` stdio server |
| [`@anscribe/core`](packages/core) | Capture model + `CaptureSink` registry. Peer dependency of every adapter package — `bun add @anscribe/opentui` pulls it in transitively. |

## Links

- [Docs](https://anscribe.dev)
- [Examples](examples/)
- [GitHub](https://github.com/msmps/anscribe)

## License

MIT © [msmps](https://github.com/msmps)
