# Anscribe React OpenTUI Example

This is an isolated `create-tui --template react --no-git --no-install` application wired to the local Anscribe workspace for manual demos. The app imports `@anscribe/opentui/react/preload` before `@opentui/react`, pulls in the MCP sink via `import "@anscribe/mcp/sink"`, then renders the headless `<Anscribe />` component from `@anscribe/opentui/react`. React-created OpenTUI renderables surface in pending Captures with `metadata.componentName` and `metadata.componentPath`.

The package boundaries used by this demo are the public ones: `@anscribe/opentui/react/preload` installs React DevTools enrichment, `@anscribe/mcp/sink` registers the SQLite Capture Store sink in `@anscribe/core`'s shared registry, `<Anscribe />` from `@anscribe/opentui/react` installs Capture Mode, and the `anscribe-mcp` binary from `@anscribe/mcp` serves pending Captures to agents. The preload import must run before `@opentui/react`; this example keeps it as the first import in `src/index.tsx`. Core Capture Mode still works without the preload, but React component metadata would be absent.

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
