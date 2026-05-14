import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { CaptureStore, CaptureStoreError, runAnscribeMcpServer } from "@anscribe/mcp";

// Pins how anscribe's MCP tools surface domain failures from CaptureStore.
// The tools must produce a CallToolResult with `isError: true` and the error
// message as text content — that's the MCP spec's tool-level failure path,
// not a protocol-level rejection.

const FailingStoreLayer = Layer.succeed(
  CaptureStore,
  CaptureStore.of({
    createCapture: () =>
      Effect.fail(new CaptureStoreError({ message: "store create unavailable" })),
    listPendingCaptures: () =>
      Effect.fail(new CaptureStoreError({ message: "store read unavailable" })),
    updateCaptureStatus: () =>
      Effect.fail(new CaptureStoreError({ message: "store write unavailable" })),
  }),
);

const setupMcpClient = Effect.gen(function* () {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  yield* runAnscribeMcpServer({ transport: serverTransport });
  const client = new Client({ name: "anscribe-test", version: "0.0.0" });
  yield* Effect.acquireRelease(
    Effect.tryPromise(() => client.connect(clientTransport)),
    () => Effect.promise(() => client.close()),
  );

  return client;
});

const callTool = (client: Client, name: string, args: Record<string, unknown>) =>
  Effect.tryPromise(() => client.callTool({ name, arguments: args }));

const FailingStoreWithCauseLayer = Layer.succeed(
  CaptureStore,
  CaptureStore.of({
    createCapture: () => Effect.die("unused"),
    listPendingCaptures: () =>
      Effect.fail(
        new CaptureStoreError({
          message: "Unable to access Anscribe Capture Store",
          cause: new Error("CLIENT_CLOSED: The client is closed"),
        }),
      ),
    updateCaptureStatus: () => Effect.die("unused"),
  }),
);

describe("anscribe MCP tools — store failure handling", () => {
  layer(FailingStoreLayer)("list_pending_captures surfaces store errors", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const client = yield* setupMcpClient;
        const response = yield* callTool(client, "list_pending_captures", {});

        expect(response.isError).toBe(true);
        expect(response.content).toEqual([{ type: "text", text: "store read unavailable" }]);
      }),
    );
  });

  layer(FailingStoreWithCauseLayer)(
    "list_pending_captures appends the underlying cause to the error text",
    (it) => {
      it.effect("runs", () =>
        Effect.gen(function* () {
          const client = yield* setupMcpClient;
          const response = yield* callTool(client, "list_pending_captures", {});

          expect(response.isError).toBe(true);
          const [content] = response.content as ReadonlyArray<{ type: string; text: string }>;
          expect(content?.text).toContain("Unable to access Anscribe Capture Store");
          expect(content?.text).toContain("Cause: CLIENT_CLOSED: The client is closed");
        }),
      );
    },
  );

  layer(FailingStoreLayer)("resolve_capture surfaces store errors", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const client = yield* setupMcpClient;
        const response = yield* callTool(client, "resolve_capture", {
          captureId: "capture_anything",
        });

        expect(response.isError).toBe(true);
        expect(response.content).toEqual([{ type: "text", text: "store write unavailable" }]);
      }),
    );
  });
});
