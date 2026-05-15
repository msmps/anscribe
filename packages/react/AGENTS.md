# @anscribe/react

**Generated:** 2026-05-15T19:19:31Z
**Commit:** ebc6dcd

Cross-framework React DevTools enrichment. Patches `__REACT_DEVTOOLS_GLOBAL_HOOK__` to capture commit roots + dispatcher refs, then walks fibers to attach `componentName`, `componentPath`, and `SourceReference[]` to captured targets. Consumed by `@anscribe/opentui`; intended substrate for future React-tree TUI adapters.

## STRUCTURE

```
src/
├── index.ts          # adapter-facing API: reactMetadataEnricher, isReactRuntimeEnrichmentAvailable
├── preload.ts        # SIDE-EFFECT MODULE — installs the DevTools hook at import time
├── fiber-pipeline.ts # fiber traversal, dispatcher probe, enrichment WeakMaps
└── source-frames.ts  # stack-frame parsing + application-frame filtering
```

## WHERE TO LOOK

| Task | Location |
|---|---|
| Adjust which frames count as "application" | `source-frames.ts` `isApplicationFrame` |
| Change componentName/path extraction | `fiber-pipeline.ts` `probeComponentSource` + dispatcher probe |
| Add a new field to `ReactRenderableMetadata` | extend `CaptureMetadata` in `@anscribe/core`, then `fiber-pipeline.ts` |

## CONVENTIONS

- **`preload.ts` is the *only* entry that has side effects.** `index.ts` is pure re-exports. Users import the side-effect form via `@anscribe/react/preload` and only at the very top of their app — before any React import.
- **Module-scoped state is intentional.** `currentDispatcherRef`, `reactMetadataEnricherRegistered`, the `probeCache` WeakMap — they're per-module because the monorepo's `tsconfig.base.json` paths force a single `@anscribe/react` instance. Don't add re-init logic; reinstallation is idempotent via symbol-keyed guards.
- **Hook patch is idempotent.** `installReactPreloadHook` checks `hook[PATCHED] === true` (Symbol.for) and `hook[ENRICHER_REGISTERED] === true` (Symbol.for) before mutating. Adding more global state? Use the same symbol-guard pattern.

## ANTI-PATTERNS

- **Don't call `reactMetadataEnricher` before the hook is installed.** `isReactRuntimeEnrichmentAvailable()` is the gate — it returns true only after `markReactRendererInjected` *and* `markReactMetadataEnricherRegistered` fire. `@anscribe/opentui`'s `<Anscribe />` already warns on this in non-production.
- **Don't replace `hook.inject` without preserving `originalInject`.** `preload.ts:69–80` records the existing inject's return value so other DevTools clients (real React DevTools, framework devtools) keep working. Wholesale replacement breaks them silently.
- **Don't read `_debugSource` / `_debugOwner` without the `ReactFiberLike` type guard.** React's debug fields are version-fragile. The dispatcher-probe path (`probeComponentSource`) is the supported route — it catches the abort sentinel and uses the cached `SourceReference`.

## NOTES

- **The dispatcher probe deliberately throws.** It calls a component function with a Proxy dispatcher that throws `ABORT_MESSAGE` on any hook access. The thrown stack is parsed for the component's source frame, then discarded. If you see `ABORT_MESSAGE` in logs, that's the mechanism working — not a bug.
- **`renderableEnrichment` is keyed by renderable object (WeakMap), not id.** Re-renders create new fiber objects but reuse renderable identity; cached enrichment survives across commits without manual eviction.
- **Why a separate `@anscribe/react` package and not bundled into `@anscribe/opentui`?** The fiber pipeline is OpenTUI-independent. Future TUI adapters (Ink, custom React reconcilers) can reuse the same enricher Layer.
