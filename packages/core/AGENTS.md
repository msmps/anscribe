# @anscribe/core

**Generated:** 2026-05-15T19:19:31Z
**Commit:** ebc6dcd

OpenTUI-agnostic capture model, project discovery, sink registry. Peer dependency of every adapter package — the singleton substrate.

## STRUCTURE

```
src/
├── schema.ts              # Capture / CapturedTarget / branded ids / tagged errors
├── capture-mode/
│   ├── state.ts           # pure state machine: intents → state transitions
│   └── service.ts         # CaptureMode + CapturePersistence + CaptureHostFailureReporter
├── picker/                # selection state + selectors
├── enrichment.ts          # CaptureMetadataEnrichment service (composable enricher layer)
├── capture-overlay.ts     # markAsOverlay tag — renderables tagged here are hidden from discovery
├── clipboard-format.ts    # Capture → markdown for OSC52
├── sinks.ts               # CaptureSink interface
├── sink-registry.ts       # process-global registry (Map keyed by sink.name)
└── project.ts             # resolveCaptureProjectBoundary (.git / workspace marker walk)
```

## WHERE TO LOOK

| Task | Location |
|---|---|
| Add a new capture intent | `capture-mode/state.ts` `CaptureModeIntent` + `transition` |
| Add a new tagged error | `schema.ts` (use `Schema.TaggedErrorClass`) |
| Wire a new sink type | implement `CaptureSink` in adapter pkg, register via `registerCaptureSink` |
| Add metadata to a target | extend `CaptureMetadata` + plumb through `CaptureMetadataEnricher` |

## CONVENTIONS

- **Branded primitives.** `CaptureId`, `CapturedTargetId`, `IsoTimestamp` are `Schema.brand`-ed strings. Generate via `generateCaptureId` / `generateCapturedTargetId` (Effect.sync over `nanoid`), never raw `nanoid()`.
- **State machine purity.** `capture-mode/state.ts` is pure: no Effect, no DateTime, no ids. Side effects (id generation, clock, persistence) live in `service.ts`.

## ANTI-PATTERNS

- **Don't call `resetCaptureSinks()` outside tests.** It's a test-only escape hatch. The registry is process-global; resetting it between two concurrent consumers in the same process silently breaks the second one. (`sink-registry.ts:23–30`)
- **Don't import `@effect/platform-node` from here.** `@anscribe/core` is platform-agnostic. Filesystem/SQL concerns live in adapter packages (`@anscribe/mcp` owns `NodeServices`).
- **Don't widen `CapturePersistence.createCapture` to throw arbitrary errors.** The contract is `Effect.Effect<void, CapturePersistenceError>`. The host adapter routes failures through `CaptureHostFailureReporter`; widening the error channel breaks that contract.

## NOTES

- `CapturePersistence` is the *adapter-supplied* service (clipboard + registered sinks). `CaptureMode` is the *core-owned* service (the state machine wrapped around a `SubscriptionRef`). They're separate so adapters can compose persistence without touching state.
- `CaptureMetadataEnrichment` is intentionally a `Layer` factory, not a function: enrichers may need their own services (e.g. `@anscribe/react` reads from the DevTools hook), so wiring them as a Layer keeps host adapters free of enricher-specific imports.
