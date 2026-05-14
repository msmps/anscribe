#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveCaptureProjectBoundary } from "@anscribe/core";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime, Path } from "effect";
import { CaptureStore, runAnscribeMcpServer } from "../src/index";
import { helpText, parseArgs, resolveProjectRootFromEnv } from "../src/cli";

const parsed = parseArgs(process.argv.slice(2));

if (parsed.kind === "help") {
  process.stdout.write(helpText());
  process.exit(0);
}

if (parsed.kind === "version") {
  process.stdout.write(`${readPackageVersion()}\n`);
  process.exit(0);
}

if (parsed.kind === "error") {
  process.stderr.write(`anscribe-mcp: ${parsed.message}\n\n${helpText()}`);
  process.exit(2);
}

const requestedProjectRoot = resolveProjectRootFromEnv(parsed, process.env);

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  // Fast-fail when the caller passed an explicit path that doesn't exist.
  // The default (process.cwd()) is always valid, so skip the check there.
  if (requestedProjectRoot !== undefined) {
    const exists = yield* fs.exists(requestedProjectRoot);

    if (!exists) {
      yield* Effect.sync(() =>
        process.stderr.write(
          `anscribe-mcp: project path does not exist: ${requestedProjectRoot}\n`,
        ),
      );

      return yield* Effect.die(new Error(`project path does not exist: ${requestedProjectRoot}`));
    }
  }

  const startPath = requestedProjectRoot ?? process.cwd();
  const { projectRoot } = yield* resolveCaptureProjectBoundary(startPath);
  const storePath = path.join(projectRoot, ".anscribe", "captures.sqlite");

  yield* Effect.sync(() => {
    process.stderr.write(`anscribe-mcp: project root = ${projectRoot}\n`);
    process.stderr.write(`anscribe-mcp: store        = ${storePath}\n`);
  });

  // Effect.never must live INSIDE the CaptureStore.layer scope: the layer
  // wraps a scoped LibsqlClient, and as soon as the providing scope ends the
  // libsql client is closed. `runAnscribeMcpServer` itself resolves the moment
  // `server.connect` succeeds (its acquireRelease sets up a finalizer but
  // doesn't block), so if we sequenced Effect.never AFTER `pipe(provide(...))`
  // the SqlClient would close before the first MCP tool call arrived and
  // every handler would surface "Unable to access Anscribe Capture Store".
  yield* Effect.gen(function* () {
    yield* runAnscribeMcpServer();
    yield* Effect.never;
  }).pipe(Effect.provide(CaptureStore.layer({ projectRoot })));
});

const runtime = ManagedRuntime.make(NodeServices.layer);

runtime
  .runPromise(Effect.scoped(program))
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => runtime.dispose());

function readPackageVersion(): string {
  const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string };

  return packageJson.version;
}
