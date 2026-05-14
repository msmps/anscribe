import { describe, expect, layer } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Path, Schema } from "effect";
import { CaptureProjectResolutionError, resolveCaptureProjectBoundary } from "@anscribe/core";

const TestBaseLayer = NodeServices.layer;

const setupFreshTmpdir = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "anscribe-project-test-" });
  const realRoot = yield* fs.realPath(root);

  return { root, realRoot };
});

describe("resolveCaptureProjectBoundary", () => {
  layer(TestBaseLayer)("resolves project root from a .git marker file", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { root, realRoot } = yield* setupFreshTmpdir;
        yield* fs.writeFileString(path.join(root, ".git"), "");

        const project = yield* resolveCaptureProjectBoundary(root);

        expect(project.projectRoot).toBe(realRoot);
      }),
    );
  });

  layer(TestBaseLayer)("resolves project root from a workspace marker (package.json)", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { root, realRoot } = yield* setupFreshTmpdir;
        yield* fs.writeFileString(path.join(root, "package.json"), "{}");

        const project = yield* resolveCaptureProjectBoundary(root);

        expect(project.projectRoot).toBe(realRoot);
      }),
    );
  });

  layer(TestBaseLayer)("walks up to find a marker in an ancestor directory", (it) => {
    it.effect("runs", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { root, realRoot } = yield* setupFreshTmpdir;
        yield* fs.writeFileString(path.join(root, ".git"), "");
        const nested = path.join(root, "src", "deep", "nested");
        yield* fs.makeDirectory(nested, { recursive: true });

        const project = yield* resolveCaptureProjectBoundary(nested);

        expect(project.projectRoot).toBe(realRoot);
      }),
    );
  });

  layer(TestBaseLayer)(
    "fails with CaptureProjectResolutionError when no markers exist above cwd",
    (it) => {
      it.effect("runs", () =>
        Effect.gen(function* () {
          const { root } = yield* setupFreshTmpdir;
          // Tmp directory under /private/tmp has no project markers all the way to /.

          const result = yield* Effect.flip(resolveCaptureProjectBoundary(root));

          expect(Schema.is(CaptureProjectResolutionError)(result)).toBe(true);
        }),
      );
    },
  );
});
