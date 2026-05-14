import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  Capture,
  CaptureId,
  CapturedTarget,
  CapturedTargetId,
  IsoTimestamp,
  TerminalCellBounds,
} from "@anscribe/core";
import { CaptureStore, runAnscribeMcpServer } from "@anscribe/mcp";

type ResolveResult = {
  readonly resolved: boolean;
  readonly captureId: string;
};

type ListPendingResult = ReadonlyArray<{ readonly id: string; readonly status: string }>;

// See `list-pending-captures.test.ts` for the rationale: MCP unit tests mock
// the CaptureStore dependency with an in-memory fake so they exercise only
// the MCP boundary, not the SQL implementation.
const makeInMemoryStore = (initial: ReadonlyArray<Capture>) => {
  const captures = new Map<string, Capture>(initial.map((c) => [c.id, c]));

  return CaptureStore.of({
    createCapture: (capture) =>
      Effect.sync(() => {
        captures.set(capture.id, capture);
      }),
    listPendingCaptures: () =>
      Effect.succeed(Array.from(captures.values()).filter((c) => c.status === "pending")),
    updateCaptureStatus: (id, status) =>
      Effect.sync(() => {
        const existing = captures.get(id);
        if (existing === undefined) return false;
        captures.set(id, new Capture({ ...existing, status }));

        return true;
      }),
  });
};

const inMemoryLayer = (initial: ReadonlyArray<Capture> = []) =>
  Layer.succeed(CaptureStore, makeInMemoryStore(initial));

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

const callResolveCapture = (client: Client, captureId: string) =>
  Effect.tryPromise(() =>
    client.callTool({
      name: "resolve_capture",
      arguments: { captureId },
    }),
  ).pipe(
    Effect.map((response) => {
      const structured = response.structuredContent as ResolveResult;

      return structured;
    }),
  );

const callListPending = (client: Client) =>
  Effect.tryPromise(() =>
    client.callTool({
      name: "list_pending_captures",
      arguments: {},
    }),
  ).pipe(
    Effect.map((response) => {
      const structured = response.structuredContent as { readonly captures: ListPendingResult };

      return structured.captures;
    }),
  );

const makePendingCapture = (id: string) =>
  new Capture({
    id: CaptureId.make(id),
    status: "pending",
    createdAt: IsoTimestamp.make("2024-01-15T10:00:00.000Z"),
    targets: [
      new CapturedTarget({
        id: CapturedTargetId.make(`${id}_target`),
        type: "BoxRenderable",
        bounds: new TerminalCellBounds({ x: 0, y: 0, width: 10, height: 1 }),
        ancestry: ["root"],
      }),
    ],
  });

describe("resolve_capture", () => {
  layer(inMemoryLayer([makePendingCapture("capture_a"), makePendingCapture("capture_b")]))(
    "resolves an existing pending capture and removes it from the pending list",
    (it) => {
      it.effect("runs", () =>
        Effect.gen(function* () {
          const client = yield* setupMcpClient;

          const result = yield* callResolveCapture(client, "capture_a");
          expect(result).toEqual({ resolved: true, captureId: "capture_a" });

          const list = yield* callListPending(client);
          expect(list.map((c) => c.id)).toEqual(["capture_b"]);
        }),
      );
    },
  );

  layer(inMemoryLayer([makePendingCapture("capture_a")]))(
    "resolving the same capture twice still reports a row match",
    (it) => {
      it.effect("runs", () =>
        Effect.gen(function* () {
          const client = yield* setupMcpClient;

          const first = yield* callResolveCapture(client, "capture_a");
          const second = yield* callResolveCapture(client, "capture_a");

          // The store contract is "row existed", not "value changed" —
          // resolving an already-resolved capture still reports `resolved: true`.
          expect(first.resolved).toBe(true);
          expect(second.resolved).toBe(true);
          const list = yield* callListPending(client);
          expect(list).toEqual([]);
        }),
      );
    },
  );

  layer(inMemoryLayer())("resolving a non-existent captureId returns resolved=false", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const client = yield* setupMcpClient;

        const result = yield* callResolveCapture(client, "capture_does_not_exist");

        expect(result).toEqual({ resolved: false, captureId: "capture_does_not_exist" });
      }),
    );
  });

  layer(
    inMemoryLayer([
      makePendingCapture("capture_a"),
      makePendingCapture("capture_b"),
      makePendingCapture("capture_c"),
    ]),
  )("resolving one capture leaves other pending captures intact", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const client = yield* setupMcpClient;

        yield* callResolveCapture(client, "capture_b");

        const list = yield* callListPending(client);
        expect(list.map((c) => c.id).sort()).toEqual(["capture_a", "capture_c"]);
      }),
    );
  });
});
