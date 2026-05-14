# Anscribe Examples

Examples are isolated from the root package so each demo app can own its runtime dependencies, lockfile, and local capture store.

- `clipboard/`: zero-install demo. Captures land on the system clipboard via OSC52 as markdown, ready to paste into any agent.
- `core/`: an OpenTUI Core app bootstrapped with `create-tui -t core`, wired to `@anscribe/mcp` for persistent pending Captures + MCP tools on top of the clipboard handoff.
- `react/`: an OpenTUI React app bootstrapped with `create-tui --template react --no-git --no-install` and wired to Anscribe's React preload plus headless `<Anscribe />` component.

To exercise the MCP path against your own agent: run `bun run mcp` from the example directory to launch the `anscribe-mcp` stdio server, then point your agent's MCP config at the same binary. The server self-orients from its process cwd, or accepts an explicit `--project <path>` / `ANSCRIBE_PROJECT_ROOT` override.
