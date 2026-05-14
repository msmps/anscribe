import type { CaptureSink } from "@anscribe/core";
import { makeCaptureStorePersistence } from "./persistence";
import type { CaptureStoreLayerOptions } from "./store";

export interface McpSinkOptions {
  /**
   * Project root for the Capture Store. Mirrors the `--project` /
   * `ANSCRIBE_PROJECT_ROOT` resolution used by the `anscribe-mcp` bin. When
   * unset, the underlying `CaptureStore.live` walks up from `process.cwd()`
   * to find a `.git` or workspace marker.
   */
  readonly projectRoot?: string;
}

/**
 * Build a `CaptureSink` that writes committed Captures into the project-local
 * SQLite store consumed by the `anscribe-mcp` stdio server.
 *
 * Most consumers should `import "@anscribe/mcp/sink"` instead — that
 * side-effect module registers `mcpSink()` with default options. Use this
 * factory directly when you need to override `projectRoot` or register more
 * than one MCP sink in the same process:
 *
 * @example
 * import { registerCaptureSink } from "@anscribe/core";
 * import { mcpSink } from "@anscribe/mcp";
 *
 * registerCaptureSink(mcpSink({ projectRoot: "/path/to/project" }));
 *
 * Each call constructs its own underlying `ManagedRuntime`, so the host's
 * `dispose()` / `close()` cleans up via the sink's `close` callback.
 */
export const mcpSink = (options: McpSinkOptions = {}): CaptureSink => {
  const persistenceOptions: CaptureStoreLayerOptions =
    options.projectRoot === undefined ? {} : { projectRoot: options.projectRoot };
  const persistence = makeCaptureStorePersistence(persistenceOptions);

  return {
    name: "anscribe-mcp",
    write: persistence.write,
    close: persistence.close,
  };
};
