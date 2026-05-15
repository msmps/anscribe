# @anscribe/opentui

**Generated:** 2026-05-15T19:19:31Z
**Commit:** ebc6dcd

OpenTUI Core adapter. Two surfaces: `installCapture(renderer, opts)` for vanilla `@opentui/core` apps, and headless `<Anscribe />` for `@opentui/react` apps. Both compose the same `installCaptureWithEnrichment` internally; only the enricher layer differs.

## STRUCTURE

```
src/
├── index.ts           # public: installCapture (vanilla — empty enricher layer)
├── react/
│   ├── index.ts       # public: <Anscribe /> (enricher = reactMetadataEnricher)
│   └── preload.ts     # re-export of @anscribe/react/preload for path symmetry
├── internal/
│   ├── install.ts     # composes CaptureMode + CapturePersistence + enricher + reporter
│   └── ids.ts         # renderable id suffix generator
├── capture-host.ts    # picker host layer — wires keys/mouse, drives CaptureMode
├── host-core.ts       # OpenTUI-binding layer for the picker
├── discovery.ts       # tree walk → visible CapturedTarget candidates
├── inspector.ts       # extracts target metadata from a renderable
├── keys.ts            # KeyEvent → CaptureModeIntent
├── host-helpers.ts    # readSelectedTargets / readRendererSize accessors
└── renderable-tree.ts # OpenTUI tree traversal utilities
```

## WHERE TO LOOK

| Task | Location |
|---|---|
| Change install surface (top-level export) | `src/index.ts` — keep it vanilla |
| Add an `InstallCaptureOptions` field | `internal/install.ts` then re-export from `index.ts` |
| Swap the enricher layer | `installCaptureWithEnrichment` 3rd arg — `<Anscribe />` passes `reactMetadataEnricher` |
| Change which renderables are pickable | `discovery.ts` (filters) + `capture-overlay.ts` in `@anscribe/core` |
| Change key routing | `keys.ts` `routeCaptureKey` |

## CONVENTIONS

- **Public stays vanilla.** `installCapture` returns `{ dispose, close }`. `Layer` / `ManagedRuntime` / `Effect` types never appear on the public surface.
- **`internal/` is the seam.** Anything that needs Effect types lives under `internal/`; `index.ts` and `react/index.ts` are the only public re-export points.
- **Integration tests use Bun, not vitest.** `test:integration` runs `bun test test/integration` because real OpenTUI requires Bun's runtime. Unit tests under `test/unit/` use vitest. Don't conflate them.

## ANTI-PATTERNS

- **Don't read `readRegisteredCaptureSinks()` after install.** Sinks are snapshotted at `installCaptureWithEnrichment` time (`internal/install.ts:42`). Adding a sink later won't reach the running host — register sinks before `installCapture`.
- **Don't add sink lifecycle outside `Effect.addFinalizer`.** Each sink's `close` is registered on the layer scope (`install.ts:73–78`); `ManagedRuntime.dispose()` then runs them in reverse order. Manual `close` calls would double-close.
- **Don't surface `Layer` on the public type.** If you need to expose enricher composition, add a new public function that builds the layer internally — `<Anscribe />` is the model.

## NOTES

- **`ManagedRuntime` is per-install.** A second `installCapture` on the same renderer creates a second runtime. The clipboard sink is keyed by renderer instance; sinks registered via the module-global registry are shared. Re-installing is supported but not common.
- **`<Anscribe />` warns once if `@anscribe/react/preload` wasn't side-effect-imported** (production env skips the warning). The preload installs the React DevTools hook before React boots; without it, fiber metadata is empty.
- **`@anscribe/react` and `@opentui/react` are optional peers.** The vanilla `installCapture` path doesn't need either; only `./react` entry pulls them in.
