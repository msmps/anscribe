import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DateTime, Effect } from "effect";
// zod is permitted at the MCP SDK boundary only — `registerTool` requires a
// zod raw-shape input schema. Domain validation continues to use Effect Schema.
import { z } from "zod/v4";
import {
  type Capture,
  type CaptureMetadata,
  parseIsoTimestampMillis,
  type SourceReference,
  type TerminalCellBounds,
} from "@anscribe/core";
import { CaptureStore, type CaptureStoreErrorChannel } from "./store";

export interface AnscribeMcpServerOptions {
  readonly name?: string;
  readonly version?: string;
  readonly transport?: Transport;
}

export type AnscribeMcpServer = McpServer;

interface McpSourceReferenceShape {
  readonly file?: string;
  readonly line?: number;
  readonly functionName?: string;
  readonly componentName?: string;
}

interface McpCapturedTargetShape {
  readonly type: string;
  readonly bounds: TerminalCellBounds;
  readonly visibleContent?: string;
  readonly metadata?: CaptureMetadata;
  readonly sourceReferences?: ReadonlyArray<McpSourceReferenceShape>;
}

interface McpCaptureShape {
  readonly id: string;
  readonly status: "pending" | "resolved";
  readonly createdAt: string;
  readonly instruction?: string;
  readonly targets: ReadonlyArray<McpCapturedTargetShape>;
}

const projectSourceReference = (
  sourceReference: SourceReference,
  metadata: CaptureMetadata | undefined,
): McpSourceReferenceShape | undefined => {
  const ownerComponent = metadata?.componentName;
  const functionName =
    sourceReference.functionName !== ownerComponent ? sourceReference.functionName : undefined;
  const componentName =
    sourceReference.componentName !== ownerComponent ? sourceReference.componentName : undefined;
  const projected: McpSourceReferenceShape = {
    ...(sourceReference.file !== undefined && { file: sourceReference.file }),
    ...(sourceReference.line !== undefined && { line: sourceReference.line }),
    ...(functionName !== undefined && { functionName }),
    ...(componentName !== undefined && { componentName }),
  };

  return Object.keys(projected).length > 0 ? projected : undefined;
};

const coarsenIsoTimestamp = (timestamp: string): string => {
  const millis = parseIsoTimestampMillis(timestamp);

  if (millis === undefined) {
    return timestamp;
  }

  return DateTime.formatIso(DateTime.makeUnsafe(Math.floor(millis / 1000) * 1000)).replace(
    ".000Z",
    "Z",
  );
};

const projectCapture = (capture: Capture): McpCaptureShape => ({
  id: capture.id,
  status: capture.status,
  createdAt: coarsenIsoTimestamp(capture.createdAt),
  ...(capture.instruction !== undefined && { instruction: capture.instruction }),
  targets: capture.targets.map((target): McpCapturedTargetShape => {
    const sourceReferences = target.sourceReferences
      ?.map((ref) => projectSourceReference(ref, target.metadata))
      .filter((ref): ref is McpSourceReferenceShape => ref !== undefined);

    return {
      type: target.type,
      bounds: target.bounds,
      ...(target.visibleContent !== undefined && { visibleContent: target.visibleContent }),
      ...(target.metadata !== undefined && { metadata: target.metadata }),
      ...(sourceReferences !== undefined && sourceReferences.length > 0 && { sourceReferences }),
    };
  }),
});

const listPendingCaptures = Effect.fn("Mcp.listPendingCaptures")(function* () {
  const store = yield* CaptureStore;
  const captures = yield* store.listPendingCaptures();

  return { captures: captures.map(projectCapture) };
});

const resolveCapture = Effect.fn("Mcp.resolveCapture")(function* (captureId: string) {
  const store = yield* CaptureStore;
  const resolved = yield* store.updateCaptureStatus(captureId, "resolved");

  return { resolved, captureId };
});

const toSuccessToolResult = (result: unknown): CallToolResult => {
  const serializableResult = result ?? null;
  const structuredContent =
    typeof serializableResult === "object" &&
    serializableResult !== null &&
    !Array.isArray(serializableResult)
      ? (serializableResult as Record<string, unknown>)
      : undefined;

  return {
    content: [{ type: "text", text: JSON.stringify(serializableResult, null, 2) }],
    structuredContent,
  };
};

// Surface `error.cause` so SQL/filesystem failures don't get summarised to a
// generic "Unable to access Anscribe Capture Store" with no information for
// the agent (or the operator reading MCP logs) to act on. The Capture Store
// only reaches this branch with errors from libsql, the filesystem, or schema
// decoding, none of which carry secrets worth hiding from the caller.
const renderErrorCause = (cause: unknown): string => {
  if (cause === undefined) return "";

  if (cause instanceof Error) {
    const inner = (cause as { cause?: unknown }).cause;
    return `\n\nCause: ${cause.message}${inner !== undefined ? renderErrorCause(inner) : ""}`;
  }

  return `\n\nCause: ${String(cause)}`;
};

const toErrorToolResult = (error: CaptureStoreErrorChannel): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: error.message + renderErrorCause(error.cause) }],
});

export const runAnscribeMcpServer = (options: AnscribeMcpServerOptions = {}) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<CaptureStore>();
    const server = new McpServer({
      name: options.name ?? "anscribe",
      version: options.version ?? "0.0.0",
    });

    const runHandler = <A>(
      effect: Effect.Effect<A, CaptureStoreErrorChannel, CaptureStore>,
    ): Promise<CallToolResult> =>
      Effect.runPromiseWith(context)(
        Effect.match(effect, { onSuccess: toSuccessToolResult, onFailure: toErrorToolResult }),
      );

    server.registerTool(
      "list_pending_captures",
      {
        title: "list_pending_captures",
        description:
          "Return pending Anscribe Captures for the MCP server's current workspace. Each Capture contains one group-level developer instruction plus selected OpenTUI targets as context.",
        annotations: { readOnlyHint: true },
      },
      () => runHandler(listPendingCaptures()),
    );

    server.registerTool(
      "resolve_capture",
      {
        title: "resolve_capture",
        description: "Mark an Anscribe Capture as resolved after addressing it.",
        inputSchema: { captureId: z.string() },
      },
      ({ captureId }) => runHandler(resolveCapture(captureId)),
    );

    yield* Effect.acquireRelease(
      Effect.tryPromise(() => server.connect(options.transport ?? new StdioServerTransport())),
      () => Effect.promise(() => server.close()),
    );

    return server;
  });
