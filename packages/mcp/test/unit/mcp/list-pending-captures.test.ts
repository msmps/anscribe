import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  Capture,
  CaptureId,
  CapturedTarget,
  CapturedTargetId,
  CaptureMetadata,
  IsoTimestamp,
  SourceReference,
  TerminalCellBounds,
} from "@anscribe/core";
import { CaptureStore, runAnscribeMcpServer } from "@anscribe/mcp";

type ListPendingResult = ReadonlyArray<{
  readonly id: string;
  readonly status: "pending" | "resolved";
  readonly createdAt: string;
  readonly instruction?: string;
  readonly targets: ReadonlyArray<{
    readonly type: string;
    readonly bounds: { x: number; y: number; width: number; height: number };
    readonly visibleContent?: string;
    readonly metadata?: {
      readonly identifier?: string;
      readonly componentName?: string;
      readonly componentPath?: string;
    };
    readonly sourceReferences?: ReadonlyArray<{
      readonly file?: string;
      readonly line?: number;
      readonly functionName?: string;
      readonly componentName?: string;
    }>;
  }>;
}>;

// In-memory CaptureStore fake. Unit tests of the MCP layer mock the store
// dependency via `Layer.succeed(CaptureStore, makeInMemoryStore(...))` so
// they exercise only the MCP projection + transport without dragging SQLite,
// filesystem, or project resolution into the test surface. Real store
// behaviour is covered by `test/unit/store.test.ts` against `CaptureStore.live`.
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

const bounds = new TerminalCellBounds({ x: 0, y: 0, width: 10, height: 1 });

const makeTarget = (overrides: {
  id?: string;
  type?: string;
  ancestry?: ReadonlyArray<string>;
  visibleContent?: string;
  metadata?: CaptureMetadata;
  sourceReferences?: ReadonlyArray<SourceReference>;
}) =>
  new CapturedTarget({
    id: CapturedTargetId.make(overrides.id ?? "target_default"),
    type: overrides.type ?? "BoxRenderable",
    bounds,
    ancestry: overrides.ancestry ?? ["root"],
    ...(overrides.visibleContent !== undefined && { visibleContent: overrides.visibleContent }),
    ...(overrides.metadata !== undefined && { metadata: overrides.metadata }),
    ...(overrides.sourceReferences !== undefined && {
      sourceReferences: overrides.sourceReferences,
    }),
  });

const makeCapture = (overrides: {
  id?: string;
  status?: "pending" | "resolved";
  createdAt?: string;
  instruction?: string;
  targets?: ReadonlyArray<CapturedTarget>;
}) =>
  new Capture({
    id: CaptureId.make(overrides.id ?? "capture_default"),
    status: overrides.status ?? "pending",
    createdAt: IsoTimestamp.make(overrides.createdAt ?? "2024-01-15T10:30:45.000Z"),
    ...(overrides.instruction !== undefined && { instruction: overrides.instruction }),
    targets: overrides.targets ?? [makeTarget({})],
  });

describe("list_pending_captures", () => {
  layer(inMemoryLayer())("returns an empty array when the store is empty", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const client = yield* setupMcpClient;
        const result = yield* callListPending(client);

        expect(result).toEqual([]);
      }),
    );
  });

  layer(
    inMemoryLayer([
      makeCapture({
        id: "capture_a",
        instruction: "Fix this row",
        targets: [
          makeTarget({
            id: "target_a",
            type: "BoxRenderable",
            visibleContent: "hello",
            metadata: new CaptureMetadata({ identifier: "row-1" }),
          }),
        ],
      }),
    ]),
  )("returns pending captures in MCP shape", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const client = yield* setupMcpClient;
        const result = yield* callListPending(client);

        expect(result).toHaveLength(1);
        const [only] = result;
        expect(only).toBeDefined();
        expect(only?.id).toBe("capture_a");
        expect(only?.status).toBe("pending");
        expect(only?.instruction).toBe("Fix this row");
        expect(only?.targets).toHaveLength(1);
        expect(only?.targets[0]?.type).toBe("BoxRenderable");
        expect(only?.targets[0]?.visibleContent).toBe("hello");
        expect(only?.targets[0]?.metadata).toEqual({ identifier: "row-1" });
        expect(only?.targets[0]).not.toHaveProperty("ancestry");
      }),
    );
  });

  layer(
    inMemoryLayer([
      makeCapture({ id: "capture_early", createdAt: "2024-01-15T10:00:00.000Z" }),
      makeCapture({ id: "capture_late", createdAt: "2024-01-15T11:00:00.000Z" }),
      makeCapture({
        id: "capture_resolved",
        status: "resolved",
        createdAt: "2024-01-15T10:30:00.000Z",
      }),
    ]),
  )("excludes resolved captures and passes through store ordering", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const client = yield* setupMcpClient;
        const result = yield* callListPending(client);

        expect(result.map((c) => c.id)).toEqual(["capture_early", "capture_late"]);
      }),
    );
  });

  layer(
    inMemoryLayer([
      makeCapture({ id: "capture_a", createdAt: "2024-01-15T10:30:45.000Z" }),
      makeCapture({ id: "capture_b", createdAt: "2024-01-15T10:30:46.999Z" }),
    ]),
  )("coarsens createdAt by stripping .000Z when milliseconds are zero", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const client = yield* setupMcpClient;
        const result = yield* callListPending(client);

        const byId = new Map(result.map((c) => [c.id, c.createdAt]));
        expect(byId.get("capture_a")).toBe("2024-01-15T10:30:45Z");
        expect(byId.get("capture_b")).toBe("2024-01-15T10:30:46Z");
      }),
    );
  });

  layer(
    inMemoryLayer([
      makeCapture({
        id: "capture_a",
        targets: [
          makeTarget({
            id: "target_a",
            metadata: new CaptureMetadata({ componentName: "Toolbar" }),
            sourceReferences: [
              new SourceReference({
                file: "src/Toolbar.tsx",
                line: 42,
                functionName: "Toolbar",
                componentName: "Toolbar",
              }),
              new SourceReference({
                file: "src/Other.tsx",
                line: 7,
                functionName: "renderRow",
                componentName: "Row",
              }),
            ],
          }),
        ],
      }),
    ]),
  )("omits sourceReference fields that duplicate metadata.componentName", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const client = yield* setupMcpClient;
        const result = yield* callListPending(client);

        const refs = result[0]?.targets[0]?.sourceReferences;
        expect(refs).toBeDefined();
        expect(refs).toHaveLength(2);
        expect(refs?.[0]).toEqual({ file: "src/Toolbar.tsx", line: 42 });
        expect(refs?.[1]).toEqual({
          file: "src/Other.tsx",
          line: 7,
          functionName: "renderRow",
          componentName: "Row",
        });
      }),
    );
  });

  layer(
    inMemoryLayer([
      makeCapture({
        id: "capture_a",
        targets: [
          makeTarget({
            id: "target_a",
            metadata: new CaptureMetadata({ componentName: "Toolbar" }),
            sourceReferences: [
              new SourceReference({ functionName: "Toolbar", componentName: "Toolbar" }),
            ],
          }),
        ],
      }),
    ]),
  )("omits sourceReferences entirely when all refs collapse to empty after dedup", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const client = yield* setupMcpClient;
        const result = yield* callListPending(client);

        expect(result[0]?.targets[0]).not.toHaveProperty("sourceReferences");
      }),
    );
  });

  layer(
    inMemoryLayer([makeCapture({ id: "capture_a", targets: [makeTarget({ id: "target_a" })] })]),
  )("omits optional fields when absent on the target", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const client = yield* setupMcpClient;
        const result = yield* callListPending(client);

        const capture = result[0];
        const target = capture?.targets[0];
        expect(capture).not.toHaveProperty("instruction");
        expect(target).not.toHaveProperty("visibleContent");
        expect(target).not.toHaveProperty("metadata");
        expect(target).not.toHaveProperty("sourceReferences");
      }),
    );
  });
});
