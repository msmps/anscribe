# Anscribe Core OpenTUI Example

This is an isolated `create-tui -t core` application wired to the local Anscribe workspace for manual demos. The app imports `installCapture` from `@anscribe/opentui` and pulls in the MCP sink via a single side-effect import (`import "@anscribe/mcp/sink"`) so each committed Capture lands on the clipboard *and* in a project-local SQLite store that the `anscribe-mcp` binary serves to agents. See `examples/clipboard` for the zero-extra-dependency variant.

The package boundaries used by this demo are the public ones: `@anscribe/opentui` installs Capture Mode in the app, and `@anscribe/mcp` provides the SQLite-backed Capture store, the `@anscribe/mcp/sink` side-effect module, and the `anscribe-mcp` server entrypoint. Captures persist project-locally; the MCP list tool orients from the server process cwd (override with `--project` or `ANSCRIBE_PROJECT_ROOT` if you need to), so the default works when you run `bun run mcp` from this directory.

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
4. Press `a` to add an instruction, type the body, then press `enter` to create a pending Capture for the selected targets.
5. In another terminal from this directory, run `bun run mcp` and call `list_pending_captures` from an MCP client.
6. Press `q` outside Capture Mode to quit.

The app uses project-local persistence at `.anscribe/captures.sqlite` under this project directory; the first run creates a `.gitignore` inside `.anscribe/` so the store stays out of version control.

This project was created using `bun create tui`. [create-tui](https://git.new/create-tui) is the easiest way to get started with OpenTUI.
