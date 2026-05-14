import { Effect, FileSystem, Path, Schema } from "effect";

export class CaptureProjectResolutionError extends Schema.TaggedErrorClass<CaptureProjectResolutionError>()(
  "CaptureProjectResolutionError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Unknown),
  },
) {}

class ProjectMarkerNotFoundError extends Schema.TaggedErrorClass<ProjectMarkerNotFoundError>()(
  "ProjectMarkerNotFoundError",
  {
    cwd: Schema.String,
    start: Schema.String,
  },
) {}

class ProjectPathResolutionError extends Schema.TaggedErrorClass<ProjectPathResolutionError>()(
  "ProjectPathResolutionError",
  {
    path: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export interface ResolvedCaptureProject {
  readonly projectRoot: string;
}

const workspaceMarkers = [
  "pnpm-workspace.yaml",
  "bun.lock",
  "package-lock.json",
  "yarn.lock",
  "package.json",
] as const;

const projectMarkerNames = [".git", ...workspaceMarkers] as const;

export const resolveCaptureProjectBoundary = (
  cwd: string,
): Effect.Effect<
  ResolvedCaptureProject,
  CaptureProjectResolutionError,
  FileSystem.FileSystem | Path.Path
> =>
  resolveCaptureProjectRoot(cwd).pipe(
    Effect.map((projectRoot) => ({ projectRoot })),
    Effect.mapError(toCaptureProjectResolutionError),
  );

const resolveCaptureProjectRoot = Effect.fn("Project.resolveCaptureProjectRoot")(function* (
  cwd: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const start = yield* Effect.mapError(
    fs.realPath(cwd),
    (cause) => new ProjectPathResolutionError({ path: cwd, cause }),
  );
  const projectRoot = yield* findProjectRoot(start);

  if (projectRoot === undefined) {
    return yield* new ProjectMarkerNotFoundError({ cwd, start });
  }

  return projectRoot;
});

const findProjectRoot = Effect.fn("Project.findProjectRoot")(function* (start: string) {
  const path = yield* Path.Path;
  let current = start;

  while (true) {
    const hasMarker = yield* hasProjectMarker(current);

    if (hasMarker) {
      return current;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
});

const hasProjectMarker = Effect.fn("Project.hasProjectMarker")(function* (directory: string) {
  const path = yield* Path.Path;

  if (yield* markerExists(path.join(directory, ".git"))) {
    return true;
  }

  for (const marker of workspaceMarkers) {
    if (yield* markerExists(path.join(directory, marker))) {
      return true;
    }
  }

  return false;
});

const markerExists = Effect.fn("Project.markerExists")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;

  return yield* Effect.mapError(
    fs.exists(path),
    (cause) => new ProjectPathResolutionError({ path, cause }),
  );
});

function toCaptureProjectResolutionError(error: unknown): CaptureProjectResolutionError {
  if (Schema.is(CaptureProjectResolutionError)(error)) {
    return error;
  }

  if (Schema.is(ProjectMarkerNotFoundError)(error)) {
    return new CaptureProjectResolutionError({
      message: `No Anscribe project markers found from ${error.start}. Add a .git directory/file or package workspace marker (${projectMarkerNames.join(", ")}).`,
      cause: error,
    });
  }

  if (Schema.is(ProjectPathResolutionError)(error)) {
    return new CaptureProjectResolutionError({
      message: `Unable to resolve Anscribe project path ${error.path}.`,
      cause: error.cause,
    });
  }

  return new CaptureProjectResolutionError({
    message: "Unable to resolve Anscribe project path.",
    cause: error,
  });
}
