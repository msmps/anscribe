# @anscribe/opentui

> Capture live UI from an [OpenTUI](https://github.com/sst/opentui) app and hand it to an agent. Clipboard by default, opt-in MCP queue.

`installCapture` installs an Anscribe Capture Mode overlay on an OpenTUI `CliRenderer`. A headless `<Anscribe />` component is exposed for OpenTUI React apps.

## Install

```bash
bun add @anscribe/opentui
```

To also persist Captures into a project-local queue that agents pull from, install [`@anscribe/mcp`](https://www.npmjs.com/package/@anscribe/mcp).

## OpenTUI Core

```ts
import { installCapture } from "@anscribe/opentui";
import { createCliRenderer } from "@opentui/core";

const renderer = await createCliRenderer({ useMouse: true });

const capture = installCapture(renderer, { keybinding: "ctrl+g" });

// On shutdown:
await capture.close();
```

The returned handle exposes `dispose()` (sync) and `close()` (async). Call one before destroying the renderer so any in-flight sink writes complete.

## OpenTUI React

```tsx
import "@anscribe/opentui/react/preload";

import { Anscribe } from "@anscribe/opentui/react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

function App() {
  return (
    <>
      <Anscribe keybinding="ctrl+g" />
      <text id="save-action" content="Save" />
    </>
  );
}

const renderer = await createCliRenderer({ useMouse: true });
createRoot(renderer).render(<App />);
```

`@anscribe/opentui/react/preload` **must be imported before `@opentui/react`**. It installs a React DevTools hook that lets Anscribe enrich Captures with `componentName` and `componentPath`. If the preload is missing or imported late, Capture Mode still works — React metadata is simply absent and `<Anscribe />` warns once in development.

The preload is a side-effect re-export of [`@anscribe/react/preload`](https://www.npmjs.com/package/@anscribe/react). Use the OpenTUI subpath here; reach for `@anscribe/react/preload` directly only if you're building a non-OpenTUI adapter.

## Capture Mode

| Key | Action |
|---|---|
| `ctrl+g` | Enter Capture Mode (configurable via `keybinding`) |
| `tab` / `↓` / `→` / `j` | Next selectable renderable |
| `shift+tab` / `↑` / `←` / `k` | Previous renderable |
| `space` / `enter` | Toggle current selection |
| `backspace` / `delete` | Deselect current target |
| `a` | Open instruction prompt |
| `enter` (in prompt) | Save pending Capture |
| `esc` (in prompt) | Cancel draft, keep selection |
| `esc` / `q` | Exit Capture Mode |

With mouse input enabled, left-clicking a renderable selects it (clicks on text-node children resolve to the containing renderable). Capture Mode draws a translucent highlight over the current target. Normal app input is paused while Capture Mode is active and resumes on exit.

## Options

`installCapture(renderer, options?)` and `<Anscribe />` share the same options:

| Option | Type | Default | |
|---|---|---|---|
| `keybinding` | `string` | `"ctrl+g"` | Entry shortcut |
| `highlightColor` | hex | — | Color of the current target highlight |
| `selectedColor` | hex | — | Color of selected targets |

## Clipboard handoff (always on)

Every committed Capture is written to the system clipboard via [OSC52](https://chromium.googlesource.com/apps/libapps/+/master/hterm/doc/ControlSequences.md#OSC-52) as markdown. Works over SSH, inside dev containers, and on terminals without native bindings or permission prompts.

The payload format:

```
fix this row to use the new auth flow

<BoxRenderable id="settings-status"> "Status: unsaved preference changes"
  in SettingsPanel (at src/settings.tsx:42)
  in App (at src/index.tsx:10)
```

## Sinks (opt-in fan-out)

Every committed Capture goes to the clipboard first; additional sinks fan out from there. The canonical sink is the MCP queue from [`@anscribe/mcp`](https://www.npmjs.com/package/@anscribe/mcp) — added with a single side-effect import at the top of your entry file:

```ts
import "@anscribe/mcp/sink";

import { installCapture } from "@anscribe/opentui";
// ...installCapture as usual; the sink is already wired.
```

The side-effect module registers the sink in `@anscribe/core`'s shared registry. `installCapture` snapshots the registry at host install time, so the import must run before the first `installCapture` call.

### Custom and programmatic sinks

For dynamic registration (tests, multi-tenant runners, custom destinations) reach for the helpers in `@anscribe/core`:

```ts
import { registerCaptureSink, type CaptureSink } from "@anscribe/core";

const webhookSink: CaptureSink = {
  name: "webhook",
  write: async (capture) => {
    await fetch("https://example.com/captures", {
      method: "POST",
      body: JSON.stringify(capture),
    });
  },
};

registerCaptureSink(webhookSink);
```

`CaptureSink`, `registerCaptureSink`, `readRegisteredCaptureSinks`, and `resetCaptureSinks` all live in `@anscribe/core` — a peer dependency of this package, so a single core instance owns the registry that every adapter shares. `resetCaptureSinks()` is provided for test isolation; production code should not use it.

If a sink fails, the host's failure reporter logs the error tagged with the sink's name. The clipboard handoff has already happened, so the user-visible state stays consistent. The capture state machine has already committed the Capture; sink failures don't roll it back.

## License

MIT © [msmps](https://github.com/msmps)
