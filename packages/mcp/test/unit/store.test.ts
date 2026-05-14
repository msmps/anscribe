import { describe, expect, layer } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer, Path } from "effect";
import {
  Capture,
  CaptureId,
  CapturedTarget,
  CapturedTargetId,
  CaptureValidationError,
  IsoTimestamp,
  TerminalCellBounds,
} from "@anscribe/core";
import { CaptureStore, CaptureStoreError } from "@anscribe/mcp";

const bounds = new TerminalCellBounds({ x: 0, y: 0, width: 10, height: 1 });

const makeTarget = (id: string, type = "BoxRenderable") =>
  new CapturedTarget({
    id: CapturedTargetId.make(id),
    type,
    bounds,
    ancestry: ["root"],
  });

const makeCapture = (
  overrides: {
    id?: string;
    status?: "pending" | "resolved";
    createdAt?: string;
    instruction?: string;
    targets?: ReadonlyArray<CapturedTarget>;
  } = {},
) =>
  new Capture({
    id: CaptureId.make(overrides.id ?? "capture_default"),
    status: overrides.status ?? "pending",
    createdAt: IsoTimestamp.make(overrides.createdAt ?? "2024-01-15T10:00:00.000Z"),
    ...(overrides.instruction !== undefined && { instruction: overrides.instruction }),
    targets: overrides.targets ?? [makeTarget("target_default")],
  });

// Build a temp project root (.git marker + chdir) and materialise the real
// production `CaptureStore.live` against it. `preSetup` runs after chdir but
// before the live layer evaluates, so a test can pre-create `.anscribe/` files
// (e.g. an existing `.gitignore`) to exercise no-overwrite behaviour.
const buildLiveTestLayer = (
  preSetup?: (anscribeDir: string) => Effect.Effect<void, never, FileSystem.FileSystem | Path.Path>,
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "anscribe-store-test-" });
      yield* fs.writeFileString(path.join(root, ".git"), "");
      const realRoot = yield* fs.realPath(root);
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const original = process.cwd();
          process.chdir(realRoot);

          return original;
        }),
        (original) => Effect.sync(() => process.chdir(original)),
      );

      if (preSetup !== undefined) {
        yield* preSetup(path.join(realRoot, ".anscribe"));
      }

      // Surface FileSystem + Path to the test body too so assertions can
      // inspect the filesystem after CaptureStore.live materialises.
      return Layer.merge(CaptureStore.live, NodeServices.layer);
    }),
  ).pipe(Layer.provide(NodeServices.layer));

const writeExistingGitignore = (anscribeDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(anscribeDir, { recursive: true });
    yield* fs.writeFileString(path.join(anscribeDir, ".gitignore"), "# custom\n*.bak\n");
  }).pipe(Effect.orDie);

describe("CaptureStore.createCapture", () => {
  layer(buildLiveTestLayer())("upserts on id conflict — latest write wins", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const store = yield* CaptureStore;
        yield* store.createCapture(
          makeCapture({
            id: "capture_a",
            instruction: "first",
            targets: [makeTarget("target_old")],
          }),
        );
        yield* store.createCapture(
          makeCapture({
            id: "capture_a",
            instruction: "second",
            targets: [makeTarget("target_new", "InputRenderable")],
          }),
        );

        const captures = yield* store.listPendingCaptures();
        expect(captures).toHaveLength(1);
        expect(captures[0]?.instruction).toBe("second");
        expect(captures[0]?.targets).toHaveLength(1);
        expect(captures[0]?.targets[0]?.id).toBe("target_new");
        expect(captures[0]?.targets[0]?.type).toBe("InputRenderable");
      }),
    );
  });

  layer(buildLiveTestLayer())(
    "surfaces decode failures as CaptureValidationError (not wrapped as CaptureStoreError)",
    (it) => {
      it.effect("runs", () =>
        Effect.gen(function* () {
          const store = yield* CaptureStore;
          // Bypass class-level validation by casting an untyped POJO. The store
          // re-decodes via decodeAnscribeDataEffect, which fails with
          // CaptureValidationError → toCaptureStoreBoundaryError passes it
          // through unwrapped.
          const invalid = { id: "x" } as unknown as Capture;

          const error = yield* Effect.flip(store.createCapture(invalid));
          expect(error).toBeInstanceOf(CaptureValidationError);
          expect(error).not.toBeInstanceOf(CaptureStoreError);
        }),
      );
    },
  );
});

describe("CaptureStore.listPendingCaptures", () => {
  layer(buildLiveTestLayer())(
    "tie-breaks by updated_at_ms (insertion order) when createdAt is identical",
    (it) => {
      it.effect("runs", () =>
        Effect.gen(function* () {
          const store = yield* CaptureStore;
          const sameCreatedAt = "2024-01-15T10:30:00.000Z";
          yield* store.createCapture(
            makeCapture({ id: "capture_first", createdAt: sameCreatedAt }),
          );
          yield* store.createCapture(
            makeCapture({ id: "capture_second", createdAt: sameCreatedAt }),
          );
          yield* store.createCapture(
            makeCapture({ id: "capture_third", createdAt: sameCreatedAt }),
          );

          const captures = yield* store.listPendingCaptures();
          expect(captures.map((c) => c.id)).toEqual([
            "capture_first",
            "capture_second",
            "capture_third",
          ]);
        }),
      );
    },
  );
});

describe("CaptureStore.live", () => {
  layer(buildLiveTestLayer())(
    "materialises the project-local store + auto-protects .anscribe/",
    (it) => {
      it.effect("creates .anscribe/captures.sqlite and writes the default .gitignore", () =>
        Effect.gen(function* () {
          const store = yield* CaptureStore;
          // Touch the store so SQL init runs and the DB file is created on disk.
          yield* store.listPendingCaptures();
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const projectRoot = yield* fs.realPath(process.cwd());
          const anscribeDir = path.join(projectRoot, ".anscribe");
          expect(yield* fs.exists(anscribeDir)).toBe(true);
          expect(yield* fs.exists(path.join(anscribeDir, "captures.sqlite"))).toBe(true);
          expect(yield* fs.readFileString(path.join(anscribeDir, ".gitignore"))).toBe(
            "*\n!.gitignore\n",
          );
        }),
      );
    },
  );

  layer(buildLiveTestLayer(writeExistingGitignore))(
    "preserves an existing .anscribe/.gitignore",
    (it) => {
      it.effect("does not overwrite a user-authored .gitignore", () =>
        Effect.gen(function* () {
          const store = yield* CaptureStore;
          yield* store.listPendingCaptures();
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const projectRoot = yield* fs.realPath(process.cwd());
          const gitignorePath = path.join(projectRoot, ".anscribe", ".gitignore");
          expect(yield* fs.readFileString(gitignorePath)).toBe("# custom\n*.bak\n");
        }),
      );
    },
  );
});

// `CaptureStore.layer({ projectRoot })` lets `anscribe-mcp` resolve the store
// from a CLI flag or env var without depending on the process cwd. We
// deliberately do NOT chdir in these tests — the whole point of the explicit
// projectRoot is that the store materialises at the path the caller asked
// for, irrespective of where the server was launched from.
const buildExplicitProjectRootTestLayer = (recordPath: (path: string) => void) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({
        prefix: "anscribe-store-explicit-root-",
      });
      yield* fs.writeFileString(path.join(root, ".git"), "");
      const realRoot = yield* fs.realPath(root);
      recordPath(realRoot);

      return Layer.merge(CaptureStore.layer({ projectRoot: realRoot }), NodeServices.layer);
    }),
  ).pipe(Layer.provide(NodeServices.layer));

describe("CaptureStore.layer({ projectRoot })", () => {
  let resolvedRoot = "";

  layer(buildExplicitProjectRootTestLayer((path) => (resolvedRoot = path)))(
    "materialises the store under the explicit projectRoot, ignoring cwd",
    (it) => {
      it.effect("creates <projectRoot>/.anscribe/captures.sqlite", () =>
        Effect.gen(function* () {
          const store = yield* CaptureStore;
          yield* store.listPendingCaptures();
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const anscribeDir = path.join(resolvedRoot, ".anscribe");
          expect(yield* fs.exists(anscribeDir)).toBe(true);
          expect(yield* fs.exists(path.join(anscribeDir, "captures.sqlite"))).toBe(true);
        }),
      );
    },
  );
});
