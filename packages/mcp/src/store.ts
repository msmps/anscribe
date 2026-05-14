import {
  Capture,
  CapturedTarget,
  type CaptureStatus,
  CaptureValidationError,
  decodeAnscribeDataEffect,
  resolveCaptureProjectBoundary,
} from "@anscribe/core";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { LibsqlClient } from "@effect/sql-libsql";
import { Clock, Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { cwd as readCurrentWorkingDirectory } from "node:process";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { pathToFileURL } from "node:url";

export type CaptureStoreErrorChannel = CaptureValidationError | CaptureStoreError;

export class CaptureStoreError extends Schema.TaggedErrorClass<CaptureStoreError>()(
  "CaptureStoreError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Unknown),
  },
) {}

interface CaptureRow {
  readonly id: string;
  readonly status: string;
  readonly createdAt: string;
  readonly instruction: string | null;
  readonly targets: string;
}

const captureTargetsJsonSchema = Schema.fromJsonString(Schema.Array(CapturedTarget));

const encodeCaptureTargets = (targets: Capture["targets"]) =>
  Schema.encodeEffect(captureTargetsJsonSchema)(targets).pipe(
    Effect.mapError(
      (cause) => new CaptureValidationError({ message: "Invalid Anscribe data", cause }),
    ),
  );

const parseCaptureRow = Effect.fn("CaptureStore.parseCaptureRow")(function* (row: CaptureRow) {
  const targets = yield* decodeAnscribeDataEffect(captureTargetsJsonSchema, row.targets);

  return yield* decodeAnscribeDataEffect(Capture, {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    ...(row.instruction !== null && { instruction: row.instruction }),
    targets,
  });
});

const initializeStore = Effect.fn("CaptureStore.initialize")(function* (sql: SqlClient) {
  yield* sql`
    create table if not exists captures (
      id text not null primary key,
      status text not null,
      created_at text not null,
      instruction text,
      targets text not null,
      updated_at_ms integer not null
    )
  `;
  yield* sql`
    create index if not exists captures_pending_idx
    on captures (status, created_at, updated_at_ms)
  `;
});

const insertCapture = Effect.fn("CaptureStore.createCapture")(function* (
  sql: SqlClient,
  capture: Capture,
) {
  const validated = yield* decodeAnscribeDataEffect(Capture, capture);
  const updatedAtMs = yield* Clock.currentTimeMillis;
  const encodedTargets = yield* encodeCaptureTargets(validated.targets);

  yield* sql`
    insert into captures (id, status, created_at, instruction, targets, updated_at_ms)
    values (
      ${validated.id},
      ${validated.status},
      ${validated.createdAt},
      ${validated.instruction ?? null},
      ${encodedTargets},
      ${updatedAtMs}
    )
    on conflict(id) do update set
      status = excluded.status,
      created_at = excluded.created_at,
      instruction = excluded.instruction,
      targets = excluded.targets,
      updated_at_ms = excluded.updated_at_ms
  `;
});

const queryPendingCaptures = Effect.fn("CaptureStore.listPendingCaptures")(function* (
  sql: SqlClient,
) {
  const rows = yield* sql<CaptureRow>`
    select id, status, created_at as createdAt, instruction, targets
    from captures
    where status = 'pending'
    order by created_at asc, updated_at_ms asc
  `;

  return yield* Effect.forEach(rows, parseCaptureRow);
});

const setCaptureStatus = Effect.fn("CaptureStore.updateCaptureStatus")(function* (
  sql: SqlClient,
  captureId: string,
  status: CaptureStatus,
) {
  const updatedAtMs = yield* Clock.currentTimeMillis;

  yield* sql`
    update captures
    set status = ${status}, updated_at_ms = ${updatedAtMs}
    where id = ${captureId}
  `;

  const result = yield* sql<{ changes: number }>`select changes() as changes`;

  return (result[0]?.changes ?? 0) > 0;
});

const toCaptureStoreBoundaryError = (error: unknown): CaptureStoreErrorChannel => {
  if (Schema.is(CaptureValidationError)(error)) {
    return error;
  }

  if (Schema.is(CaptureStoreError)(error)) {
    return error;
  }

  return new CaptureStoreError({
    message: "Unable to access Anscribe Capture Store",
    cause: error,
  });
};

const makeCaptureSqlLayer = (databasePath: string) => {
  const clientLayer = LibsqlClient.layer({ url: pathToFileURL(databasePath) });

  const initLayer = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient;
      yield* initializeStore(sql);
    }),
  ).pipe(Layer.provide(clientLayer));

  return Layer.merge(clientLayer, initLayer).pipe(
    Layer.provideMerge(NodeServices.layer),
    // SQL/Platform construction failures are setup defects (bad database path,
    // permission errors). Operational SQL errors at method-call time stay
    // typed and reach callers via `toCaptureStoreBoundaryError`.
    Layer.orDie,
  );
};

interface CaptureStoreShape {
  readonly createCapture: (capture: Capture) => Effect.Effect<void, CaptureStoreErrorChannel>;
  readonly listPendingCaptures: () => Effect.Effect<readonly Capture[], CaptureStoreErrorChannel>;
  readonly updateCaptureStatus: (
    captureId: string,
    status: CaptureStatus,
  ) => Effect.Effect<boolean, CaptureStoreErrorChannel>;
}

// Ensures `<projectRoot>/.anscribe/` exists and auto-protects it with a
// `.gitignore`. The `wx` flag is exclusive-create — an existing `.gitignore`
// is preserved untouched, and a TOCTOU race where another process won the
// write is tolerated.
const ensureProjectAnscribeStorage = Effect.fn("CaptureStore.ensureProjectAnscribeStorage")(
  function* (anscribeDir: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(anscribeDir, { recursive: true });
    yield* fs
      .writeFileString(path.join(anscribeDir, ".gitignore"), "*\n!.gitignore\n", { flag: "wx" })
      .pipe(Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.void));
  },
);

/**
 * Options for `CaptureStore.layer`. `projectRoot` is the *starting* path for
 * project-marker discovery; the layer walks up from there looking for `.git`
 * or a workspace marker. When unset, the layer falls back to
 * `process.cwd()` — the same behaviour as `CaptureStore.live`.
 */
export interface CaptureStoreLayerOptions {
  readonly projectRoot?: string;
}

export class CaptureStore extends Context.Service<CaptureStore, CaptureStoreShape>()(
  "anscribe/store/CaptureStore",
) {
  /**
   * Project-local store factory. The resulting layer materialises
   * `<resolved-project-root>/.anscribe/captures.sqlite`; the `.anscribe/`
   * directory is created lazily and auto-protected via `.gitignore`.
   *
   * `anscribe-mcp`'s bin entry uses this with the resolved CLI/env project
   * root so the store is always project-local even when the agent launches
   * the server from somewhere other than the project cwd.
   */
  static readonly layer = (options: CaptureStoreLayerOptions = {}) =>
    Layer.unwrap(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const startPath = options.projectRoot ?? readCurrentWorkingDirectory();
        const project = yield* resolveCaptureProjectBoundary(startPath);
        const anscribeDir = path.join(project.projectRoot, ".anscribe");
        // FS setup failures (missing permissions, read-only mounts) are not
        // recoverable at the caller level — surface them as defects rather than
        // leaking PlatformError into the installCapture/MCP boundaries.
        yield* ensureProjectAnscribeStorage(anscribeDir).pipe(Effect.orDie);
        const databasePath = path.join(anscribeDir, "captures.sqlite");

        return Layer.effect(
          CaptureStore,
          Effect.gen(function* () {
            const sql = yield* SqlClient;

            return CaptureStore.of({
              createCapture: (capture) =>
                insertCapture(sql, capture).pipe(Effect.mapError(toCaptureStoreBoundaryError)),
              listPendingCaptures: () =>
                queryPendingCaptures(sql).pipe(Effect.mapError(toCaptureStoreBoundaryError)),
              updateCaptureStatus: (captureId, status) =>
                setCaptureStatus(sql, captureId, status).pipe(
                  Effect.mapError(toCaptureStoreBoundaryError),
                ),
            });
          }),
        ).pipe(Layer.provide(makeCaptureSqlLayer(databasePath)));
      }),
    ).pipe(Layer.provide(NodeServices.layer));

  /**
   * Convenience singleton: `CaptureStore.layer()` with default cwd-based
   * resolution. Used by `@anscribe/opentui`'s vanilla `installCapture` boundary
   * and by tests that exercise the real SQL behaviour against a temp project.
   */
  static readonly live = CaptureStore.layer();
}
