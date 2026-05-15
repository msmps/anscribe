# @anscribe/mcp

**Generated:** 2026-05-15T19:19:31Z
**Commit:** ebc6dcd

Two surfaces: a `CaptureSink` that writes pending Captures to a project-local SQLite store (`<projectRoot>/.anscribe/captures.sqlite`), and the `anscribe-mcp` stdio server that exposes that store via MCP tools.

## STRUCTURE

```
src/
├── index.ts        # public: CaptureStore, runAnscribeMcpServer, mcpSink, etc.
├── sink.ts         # side-effect entry — `import "@anscribe/mcp/sink"` registers the sink
├── mcp-sink.ts     # CaptureSink impl backed by CaptureStore
├── store.ts        # CaptureStore service (libsql + Effect/sql) + tagged errors
├── persistence.ts  # storage helpers shared by sink + server
├── server.ts       # runAnscribeMcpServer — registers MCP tools, threads errors
└── cli.ts          # parseArgs / helpText / resolveProjectRootFromEnv
bin/
└── anscribe-mcp.ts # bin entry — resolves project, scopes runtime, blocks on Effect.never
```

## WHERE TO LOOK

| Task | Location |
|---|---|
| Add an MCP tool | `server.ts` `server.registerTool(...)` inside `runAnscribeMcpServer` |
| Change SQL schema | `store.ts` `initializeStore` — uses `create table if not exists` (no migrations yet) |
| Change the projectRoot resolution chain | `bin/anscribe-mcp.ts` + `cli.ts` `resolveProjectRootFromEnv` |
| Configure sink with explicit projectRoot | `mcpSink({ projectRoot })` via `registerCaptureSink` |

## CONVENTIONS

- **Zod lives only in `server.ts`, only for `registerTool({ inputSchema })`.** MCP SDK requires a zod raw shape — `{ captureId: z.string() }`, not `z.object({...})`. Domain validation continues to use Effect Schema (`@anscribe/core/schema.ts`).
- **`Schema.fromJsonString` for round-tripped JSON columns.** `targets` is stored as JSON; `store.ts:34` defines `captureTargetsJsonSchema = Schema.fromJsonString(Schema.Array(CapturedTarget))` so encode/decode is one step.
- **SQL setup failures are defects, not errors.** `makeCaptureSqlLayer` ends with `Layer.orDie` — bad paths / missing permissions surface as defects. Operational SQL errors at method-call time stay typed via `toCaptureStoreBoundaryError`.

## ANTI-PATTERNS

- **Don't sequence `Effect.never` AFTER `pipe(Effect.provide(CaptureStore.layer(...)))`.** The providing scope ends as soon as `runAnscribeMcpServer` resolves (its `acquireRelease` returns immediately on `server.connect`). If `Effect.never` runs *outside* the scope, the libsql client closes and every tool call surfaces "Unable to access Anscribe Capture Store". `bin/anscribe-mcp.ts:65–68` is the canonical layout — keep it.
- **Don't summarise `CaptureStoreError.cause` away.** `server.ts:135–144` walks `cause.cause` chains so SQL/FS failures reach the agent. Domain errors carry only generic schema metadata, never secrets — verbatim cause is safe.
- **Don't use `z.object({...})` for tool input.** SDK wants the raw shape. `z.object` results in a top-level "input" wrapper.

## NOTES

- **`.anscribe/.gitignore` is written exclusive-create (`flag: "wx"`).** Existing user-authored gitignores are preserved; a TOCTOU race where another process won is tolerated. Don't change to plain write — that would clobber user customisation.
- **`coarsenIsoTimestamp` rounds `createdAt` to second precision** on the MCP output projection (`server.ts:68–79`). Agents don't need millis, and rounding stabilises golden-file tests.
- **`runAnscribeMcpServer` reads `CaptureStore` from `Effect.context`** rather than threading it as a requirement on each handler — keeps `registerTool` callbacks plain Promises. This is a deliberate boundary against the MCP SDK's callback shape.
