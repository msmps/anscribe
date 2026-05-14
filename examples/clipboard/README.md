# Anscribe Clipboard Example

Zero-install demo of the default Anscribe Capture loop. The app calls `installCapture` from `@anscribe/opentui` — every committed Capture is copied to the system clipboard via OSC52 as a markdown payload ready to paste into Claude Code, Cursor, or any other agent.

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run dev
```

Demo flow:

1. Press `ctrl+g` to enter Anscribe Capture Mode.
2. Use `tab` to move the highlight and `space` to select a renderable.
3. Click another renderable to select by mouse.
4. Press `a` to add an instruction, type the body, then press `enter`. The instruction + selected target(s) land on your clipboard.
5. Paste into your agent. Done.
6. Press `q` outside Capture Mode to quit.

The clipboard payload is a small markdown block — developer instruction followed by each selected target with its renderable type, identifiers, visible text, and component stack:

```
fix this row to use the new auth flow

<BoxRenderable id="settings-status"> "Status: unsaved preference changes"
  in SettingsPanel (at src/settings.tsx:42)
  in App (at src/index.tsx:10)
```

Want a persistent pending-Capture queue plus MCP tools so the agent can pull work asynchronously? Use `examples/core`, which installs `@anscribe/mcp` and pulls in the SQLite sink with a single `import "@anscribe/mcp/sink"`.

This project was created using `bun create tui`. [create-tui](https://git.new/create-tui) is the easiest way to get started with OpenTUI.
