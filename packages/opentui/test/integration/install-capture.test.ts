import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BoxRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, ManagedRuntime } from "effect";
import { registerCaptureSink, resetCaptureSinks } from "@anscribe/core";
import { CaptureStore, mcpSink } from "@anscribe/mcp";
import { installCapture } from "../../src/index";

// Exercises the public installCapture boundary end-to-end. The host-layer unit
// tests in host.test.ts swap in a fake CapturePersistence Layer; this file
// pins the registry contract: with no sinks registered, default → clipboard
// only; with `mcpSink()` registered, the SQLite store is also written.
//
// We use the programmatic `registerCaptureSink` / `resetCaptureSinks` helpers
// here (instead of a top-of-file `import "@anscribe/mcp/sink"`) so the two
// tests stay isolated — each test starts from a clean registry and the chdir
// to the temp project root happens before the sink's underlying
// ManagedRuntime captures `process.cwd()`.

describe("installCapture", () => {
  let tempProjectRoot: string;
  let originalCwd: string;

  beforeEach(() => {
    tempProjectRoot = mkdtempSync(join(tmpdir(), "anscribe-install-capture-project-"));
    writeFileSync(join(tempProjectRoot, ".git"), "");
    originalCwd = process.cwd();
    process.chdir(tempProjectRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempProjectRoot, { recursive: true, force: true });
    resetCaptureSinks();
  });

  test("close() resolves cleanly when no capture work was triggered", async () => {
    const { renderer, renderOnce } = await createTestRenderer({
      width: 80,
      height: 24,
      useMouse: true,
      exitOnCtrlC: false,
      kittyKeyboard: true,
    });
    await renderOnce();

    const installation = installCapture(renderer);
    await installation.close();
  });

  test("a registered mcpSink writes a Capture row through @anscribe/mcp", async () => {
    const { renderer, mockInput, renderOnce } = await createTestRenderer({
      width: 80,
      height: 24,
      useMouse: true,
      exitOnCtrlC: false,
      kittyKeyboard: true,
    });
    const box = new BoxRenderable(renderer, {
      id: "install-capture-test-box",
      position: "absolute",
      left: 0,
      top: 0,
      width: 10,
      height: 3,
    });
    renderer.root.add(box);
    await renderOnce();

    registerCaptureSink(mcpSink());
    const installation = installCapture(renderer);

    mockInput.pressKey("g", { ctrl: true });
    mockInput.pressTab();
    mockInput.pressKey("a");
    for (const ch of "fixme") {
      mockInput.pressKey(ch);
    }
    mockInput.pressEnter();

    // close() runs the composite persistence layer's scope finalizer, which
    // disposes the mcpSink runtime — so the row is durably written by the
    // time this resolves.
    await installation.close();

    const verifyRuntime = ManagedRuntime.make(CaptureStore.live);
    try {
      const captures = await verifyRuntime.runPromise(
        Effect.gen(function* () {
          const store = yield* CaptureStore;
          return yield* store.listPendingCaptures();
        }),
      );
      expect(captures.length).toBe(1);
      expect(captures[0]?.instruction).toBe("fixme");
      expect(captures[0]?.targets.length).toBe(1);
    } finally {
      await verifyRuntime.dispose();
    }
  });
});
