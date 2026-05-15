# anscribe

**Generated:** 2026-05-15T19:19:31Z
**Commit:** ebc6dcd

OpenTUI capture-to-agent toolkit: press a keybinding inside a TUI, select renderables, ship the result via clipboard (default) or a local MCP stdio server. Effect-based monorepo of four version-locked publishable packages.

## STRUCTURE

```
packages/
├── core/        # capture model, sink registry singleton, project discovery (AGENTS.md)
├── opentui/     # OpenTUI adapter — installCapture + headless <Anscribe /> (AGENTS.md)
├── mcp/         # SQLite Capture Store + anscribe-mcp stdio server (AGENTS.md)
└── react/       # cross-framework React DevTools enrichment substrate (AGENTS.md)
apps/docs/       # Vite + Cloudflare Worker marketing site (anscribe.dev)
examples/        # clipboard / core / react demo apps wired to the workspace
scripts/         # sync-package-meta.ts (LICENSE byte-sync to publishable packages)
```

## WHERE TO LOOK

| Task | Location |
|---|---|
| Capture data model + branded ids | `packages/core/src/schema.ts` |
| Capture state machine (intents → state) | `packages/core/src/capture-mode/{state,service}.ts` |
| Process-global sink registry | `packages/core/src/sink-registry.ts` |
| Project root discovery (.git / workspace markers) | `packages/core/src/project.ts` |
| Wiring sinks at host install time | `packages/opentui/src/internal/install.ts` |
| MCP tool surface (list/resolve) | `packages/mcp/src/server.ts` |
| MCP CLI entry | `packages/mcp/bin/anscribe-mcp.ts` |
| React fiber + DevTools hook | `packages/react/src/{fiber-pipeline,preload}.ts` |
| Shared tsconfig + source-resolution paths | `tsconfig.base.json` |
| Changeset config (fixed version group) | `.changeset/config.json` |

## CONVENTIONS

- **Effect-native everywhere.** Domain code uses `Context.Service` + `Layer`; errors are `Schema.TaggedErrorClass`; ids are `Schema.brand`. Mechanical Promise→Effect ports are not acceptable.
- **Effect Schema is the validation layer.** Zod is permitted at exactly one boundary: `McpServer.registerTool({ inputSchema })` in `packages/mcp/src/server.ts` (MCP SDK requires a zod raw shape). Nowhere else.
- **Public surfaces stay vanilla; internals go full Effect.** `installCapture(renderer, options)` returns a plain object with `dispose()`; the `Layer`/`ManagedRuntime` machinery is internal.
- **Don't suffix Effect-returning identifiers with `Effect`.** Type tells the story. Single sanctioned exception: `decodeAnscribeData` (sync) vs `decodeAnscribeDataEffect`.
- **Bun is the dev runtime; pnpm is the publish runtime.** `bun.lock` is the source of truth and is committed; `pnpm-lock.yaml` is gitignored. `pnpm` is used only by `release`.
- **Test services via `Layer.succeed(Service, fakeImpl)`.** Don't add test-only escape hatches to production layers. `resetCaptureSinks` exists but is the only one — adding another is a smell.

## ANTI-PATTERNS

- **Don't break the `@anscribe/core` singleton.** Every adapter declares `@anscribe/core` as a *peer dependency*, and `tsconfig.base.json` `paths` force `@anscribe/*` to resolve to `src/` across the monorepo. Two `@anscribe/core` instances ⇒ two `sink-registry` Maps ⇒ MCP sink silently drops captures.
- **Don't end the providing scope before MCP traffic starts.** `Effect.never` must live *inside* the `CaptureStore.layer` scope. Sequencing it after `pipe(provide(...))` closes the libsql client before the first tool call. See `packages/mcp/bin/anscribe-mcp.ts:65–68`.
- **Don't add zod for "consistency."** Use Effect Schema. Zod stays scoped to the MCP `registerTool` shape.

## COMMANDS

```bash
bun run check              # full gate: lint, format:check, typecheck, build, test, check:meta
bun run typecheck:tsgo     # Effect-aware typecheck via @effect/tsgo (patches tsc)
bun run tsgo:patch         # apply tsgo patch (required before typecheck:tsgo if drifted)
bun run mcp                # run anscribe-mcp from source (no build needed)
bun run sync:meta          # propagate root LICENSE to publishable packages
bun run check:meta         # CI: assert per-package LICENSE matches root byte-for-byte
bun run test:integration   # opentui-only — uses bun test (not vitest) for real OpenTUI runtime
```

## KEY CONFIGS

| Tool | Entry | Notes |
|---|---|---|
| TypeScript paths | `tsconfig.base.json` | `@anscribe/*` → `packages/*/src/index.ts` — singleton invariant |
| Lint | `.oxlintrc.json` | oxlint (Rust-based) — runs across packages/examples/apps |
| Format | `.oxfmtrc.json` | oxfmt; excludes `.repos/**` and `**/dist/**` |
| Build | `packages/*/tsdown.config.ts` | tsdown emits `dist/*.mjs` + `.d.mts` |
| Bun install policy | `bunfig.toml` | `minimumReleaseAge = 86400` — 24h delay on new package versions |
| Changesets | `.changeset/config.json` | Four packages are a fixed-version group; examples + docs are ignored |

## NOTES

- **README intentionality.** Root README is *marketing*. Per-package READMEs are *API reference*. `sync-package-meta.ts` syncs `LICENSE` but never READMEs — by design.
- **MCP `inputSchema` quirk.** `list_pending_captures` omits `inputSchema` (no params); `resolve_capture` declares `{ captureId: z.string() }` as a *raw shape* (not `z.object({...})`). The SDK insists on the raw shape.
- **Capture Store path resolution.** `anscribe-mcp` walks up from `--project` / `ANSCRIBE_PROJECT_ROOT` / cwd looking for `.git` or workspace marker. If you launch the server from `~`, you'll get a `~/.anscribe/captures.sqlite` that doesn't match the example's store.
