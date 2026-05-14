# @anscribe/react

> Cross-framework React DevTools enrichment for Anscribe Captures.

Installs a React DevTools hook that captures React's `currentDispatcherRef` and observes commits. Anscribe's host adapters (`@anscribe/opentui` today; `@anscribe/ink` and friends are the intended future) consume it to enrich Captures with `componentName`, `componentPath`, and source-frame references.

This package is the cross-framework substrate. Most users should reach for the host adapter's re-export instead — for OpenTUI that's [`@anscribe/opentui/react/preload`](https://www.npmjs.com/package/@anscribe/opentui).

## When to use this package directly

Import `@anscribe/react/preload` directly when:

- You're building a non-OpenTUI Anscribe host adapter and want to share the enricher.
- You're embedding the enricher into a custom React TUI bootstrapper where adapter subpaths don't fit your build pipeline.

Otherwise, prefer your host adapter's preload subpath.

## Install

```bash
bun add @anscribe/react
```

`react@>=19.2.0` is a peer dependency.

## Use

```ts
// MUST be imported before "react" / "@opentui/react" / your React renderer
import "@anscribe/react/preload";
```

The preload installs `globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__` (or patches an existing one) before React reads it. It must run **before** the first React render, otherwise the renderer is created without the hook attached and metadata enrichment silently no-ops.

Adapter-internal API (consumed by host adapters, not end users):

```ts
import { reactMetadataEnricher, isReactRuntimeEnrichmentAvailable } from "@anscribe/react";
```

## License

MIT © [msmps](https://github.com/msmps)
