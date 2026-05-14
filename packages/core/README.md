# @anscribe/core

> Framework-agnostic Capture model + `CaptureSink` registry. Peer dependency of every Anscribe adapter package.

You almost certainly want [`@anscribe/opentui`](https://www.npmjs.com/package/@anscribe/opentui) (`bun add @anscribe/opentui` pulls this in transitively).

This package holds the Schema definitions (`Capture`, `CapturedTarget`, `TerminalCellBounds`, …), the framework-agnostic Capture Mode state machine, and the process-global `CaptureSink` registry that host adapters (`@anscribe/opentui`, future Ink/blessed adapters) read from and that sink producers (`@anscribe/mcp`) write into. Living here — and being a `peerDependencies` entry on every adapter — is what keeps the registry a single instance across packages.

## Public API for sink authors

Most users never import from `@anscribe/core` directly. The exception is anyone writing or wiring a custom `CaptureSink`:

```ts
import { type CaptureSink, registerCaptureSink } from "@anscribe/core";

const webhookSink: CaptureSink = {
  name: "webhook",
  write: async (capture) => {
    await fetch("https://example.com/captures", { method: "POST", body: JSON.stringify(capture) });
  },
};

registerCaptureSink(webhookSink);
```

`readRegisteredCaptureSinks()` is provided for host adapters; `resetCaptureSinks()` is a test-only escape hatch.

## License

MIT © [msmps](https://github.com/msmps)
