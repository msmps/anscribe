// Side-effect module: importing `@anscribe/mcp/sink` registers the SQLite
// Capture Store sink in the shared `@anscribe/core` registry, so any
// subsequent `installCapture` call (from `@anscribe/opentui` or any other
// host adapter) writes committed Captures both to the clipboard and to the
// project-local store consumed by `anscribe-mcp`.
//
//   import "@anscribe/mcp/sink";
//   import { installCapture } from "@anscribe/opentui";
//   installCapture(renderer, { keybinding: "ctrl+g" });
//
// Power users who need to configure the sink (e.g. an explicit `projectRoot`
// or running multiple sinks against different stores) should reach for the
// programmatic surface instead:
//
//   import { registerCaptureSink } from "@anscribe/core";
//   import { mcpSink } from "@anscribe/mcp";
//   registerCaptureSink(mcpSink({ projectRoot: "/path/to/project" }));

import { registerCaptureSink } from "@anscribe/core";
import { mcpSink } from "./mcp-sink";

registerCaptureSink(mcpSink());
