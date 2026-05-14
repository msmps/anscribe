import { afterEach, describe, expect, test } from "bun:test";
import { BoxRenderable, type InputRenderable } from "@opentui/core";
import { createTestRenderer, MouseButtons } from "@opentui/core/testing";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
  type Capture,
  CaptureHostFailureReporter,
  CaptureMetadataEnrichment,
  CaptureMode,
  type CaptureModeDispatchError,
  CapturePersistence,
  CaptureValidationError,
  isAnscribeOverlay,
} from "@anscribe/core";
import { makeCaptureHostLayer } from "../../src/capture-host";
import { walkRenderableTree } from "../../src/renderable-tree";

// The host layer is acquired/disposed via a ManagedRuntime in each test so we
// get the real finalizer order without sharing state between tests.

type FakePersistence = {
  readonly captures: Capture[];
  fail?: CaptureModeDispatchError;
};

const makePersistenceLayer = (state: FakePersistence) =>
  Layer.succeed(
    CapturePersistence,
    CapturePersistence.of({
      createCapture: (capture) =>
        state.fail !== undefined
          ? Effect.fail(state.fail)
          : Effect.sync(() => {
              state.captures.push(capture);
            }),
    }),
  );

const makeFailureLayer = (recorded: CaptureModeDispatchError[]) =>
  Layer.succeed(
    CaptureHostFailureReporter,
    CaptureHostFailureReporter.of({
      report: (error) =>
        Effect.sync(() => {
          recorded.push(error);
        }),
    }),
  );

const buildTestHost = async (options: { keybinding?: string; addTargets?: boolean } = {}) => {
  const { renderer, mockInput, mockMouse, renderOnce, resize } = await createTestRenderer({
    width: 80,
    height: 24,
    useMouse: true,
    exitOnCtrlC: false,
    // kittyKeyboard avoids the legacy parser's ESC-disambiguation timeout so
    // pressEscape() takes effect synchronously.
    kittyKeyboard: true,
  });

  if (options.addTargets !== false) {
    const box = new BoxRenderable(renderer, {
      id: "test-box-a",
      position: "absolute",
      left: 0,
      top: 0,
      width: 10,
      height: 3,
    });
    renderer.root.add(box);
  }

  await renderOnce();

  const persistenceState: FakePersistence = { captures: [] };
  const failures: CaptureModeDispatchError[] = [];

  const composedLayer = makeCaptureHostLayer(renderer, options).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        CaptureMode.live,
        CaptureMetadataEnrichment.live,
        makePersistenceLayer(persistenceState),
        makeFailureLayer(failures),
      ),
    ),
  );

  const runtime = ManagedRuntime.make(composedLayer);
  await runtime.runPromise(Effect.void);

  const currentState = () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const captureMode = yield* CaptureMode;
        return yield* captureMode.current();
      }),
    );

  return {
    renderer,
    mockInput,
    mockMouse,
    renderOnce,
    resize,
    runtime,
    currentState,
    persistenceState,
    failures,
    dispose: () => runtime.dispose(),
  };
};

const findInstructionInput = (host: Awaited<ReturnType<typeof buildTestHost>>) => {
  let found: InputRenderable | undefined;
  walkRenderableTree(host.renderer.root, (renderable) => {
    if (
      typeof renderable.id === "string" &&
      renderable.id.startsWith("anscribe-capture-instruction-") &&
      renderable.id.endsWith("-input")
    ) {
      found = renderable as unknown as InputRenderable;
    }
  });
  return found;
};

const findInspector = (host: Awaited<ReturnType<typeof buildTestHost>>) => {
  let found: Record<string, unknown> | undefined;
  walkRenderableTree(host.renderer.root, (renderable) => {
    if (
      typeof renderable.id === "string" &&
      renderable.id.startsWith("anscribe-inspector-") &&
      !renderable.id.endsWith("-text")
    ) {
      found = renderable;
    }
  });
  return found;
};

const readInspectorText = (host: Awaited<ReturnType<typeof buildTestHost>>): string | undefined => {
  let text: string | undefined;
  walkRenderableTree(host.renderer.root, (renderable) => {
    if (
      typeof renderable.id === "string" &&
      renderable.id.startsWith("anscribe-inspector-") &&
      renderable.id.endsWith("-text")
    ) {
      const chunks = (renderable as { chunks?: ReadonlyArray<{ text?: string }> }).chunks;
      if (Array.isArray(chunks)) {
        text = chunks.map((chunk) => (typeof chunk.text === "string" ? chunk.text : "")).join("");
      }
    }
  });
  return text;
};

describe("makeCaptureHostLayer — layer lifecycle", () => {
  let host: Awaited<ReturnType<typeof buildTestHost>> | undefined;

  afterEach(async () => {
    await host?.dispose();
    host = undefined;
  });

  test("acquires cleanly and exposes initial inactive state", async () => {
    host = await buildTestHost();
    const state = await host.currentState();
    expect(state.active).toBe(false);
    expect(state.targets).toEqual([]);
  });

  test("ignores keypresses that don't match the configured keybinding", async () => {
    host = await buildTestHost();
    host.mockInput.pressKey("x");
    const state = await host.currentState();
    expect(state.active).toBe(false);
  });
});

describe("makeCaptureHostLayer — keypress orchestration", () => {
  let host: Awaited<ReturnType<typeof buildTestHost>> | undefined;

  afterEach(async () => {
    await host?.dispose();
    host = undefined;
  });

  test("ctrl+g (default keybinding) enters capture mode with discovered targets", async () => {
    host = await buildTestHost();
    host.mockInput.pressKey("g", { ctrl: true });
    const state = await host.currentState();
    expect(state.active).toBe(true);
    expect(state.targets.length).toBeGreaterThan(0);
    // Discovery generates a fresh CapturedTargetId; the renderable's own `id`
    // is recorded as metadata.identifier instead.
    expect(state.targets.some((target) => target.metadata?.identifier === "test-box-a")).toBe(true);
    // Cursor stays unset on entry — nothing is highlighted until the user
    // hovers, clicks, or Tabs.
    expect(state.currentIndex).toBe(-1);
  });

  test("respects a custom keybinding option", async () => {
    host = await buildTestHost({ keybinding: "ctrl+k" });
    host.mockInput.pressKey("g", { ctrl: true });
    expect((await host.currentState()).active).toBe(false);
    host.mockInput.pressKey("k", { ctrl: true });
    expect((await host.currentState()).active).toBe(true);
  });

  test("'tab' inside capture mode advances currentIndex", async () => {
    host = await buildTestHost();
    host.mockInput.pressKey("g", { ctrl: true });
    const before = await host.currentState();
    host.mockInput.pressTab();
    const after = await host.currentState();
    if (before.targets.length > 1) {
      expect(after.currentIndex).toBe((before.currentIndex + 1) % before.targets.length);
    } else {
      expect(after.currentIndex).toBe(0);
    }
  });

  test("'escape' exits capture mode", async () => {
    host = await buildTestHost();
    host.mockInput.pressKey("g", { ctrl: true });
    expect((await host.currentState()).active).toBe(true);
    host.mockInput.pressEscape();
    expect((await host.currentState()).active).toBe(false);
  });
});

describe("makeCaptureHostLayer — instruction draft", () => {
  let host: Awaited<ReturnType<typeof buildTestHost>> | undefined;

  afterEach(async () => {
    await host?.dispose();
    host = undefined;
  });

  test("'a' starts a draft and mounts an InputRenderable in the renderer tree", async () => {
    host = await buildTestHost();
    host.mockInput.pressKey("g", { ctrl: true });
    host.mockInput.pressTab(); // entry leaves cursor unset; Tab lands it on a target so StartDraft has a fallback
    host.mockInput.pressKey("a");

    const state = await host.currentState();
    expect(state.instructionDraft).toBe(true);
    expect(findInstructionInput(host)).toBeDefined();
  });

  test("'escape' from a draft cancels and removes the renderable", async () => {
    host = await buildTestHost();
    host.mockInput.pressKey("g", { ctrl: true });
    host.mockInput.pressTab();
    host.mockInput.pressKey("a");
    expect(findInstructionInput(host)).toBeDefined();

    host.mockInput.pressEscape();

    const state = await host.currentState();
    expect(state.instructionDraft).toBe(false);
    expect(findInstructionInput(host)).toBeUndefined();
  });

  test("resizing the terminal narrower rescales the live draft", async () => {
    host = await buildTestHost();
    host.mockInput.pressKey("g", { ctrl: true });
    host.mockInput.pressTab();
    host.mockInput.pressKey("a");

    const draftBefore = findInstructionInput(host);
    expect(draftBefore).toBeDefined();
    // Initial renderer is 80 cells wide; draft caps at 44.
    expect(draftBefore!.width).toBe(44 - 4);

    host.resize(30, 24);
    await host.renderOnce();

    const draftAfter = findInstructionInput(host);
    expect(draftAfter).toBeDefined();
    // 30-cell terminal → boxWidth = min(30, 44) = 30 → input = 30 - 4 = 26.
    expect(draftAfter!.width).toBe(30 - 4);
  });
});

describe("makeCaptureHostLayer — mouse orchestration", () => {
  let host: Awaited<ReturnType<typeof buildTestHost>> | undefined;

  afterEach(async () => {
    await host?.dispose();
    host = undefined;
  });

  test("primary-button click inside capture mode dispatches SelectAtCell", async () => {
    host = await buildTestHost();
    host.mockInput.pressKey("g", { ctrl: true });

    const before = await host.currentState();
    const target = before.targets.find((t) => t.metadata?.identifier === "test-box-a");
    expect(target).toBeDefined();

    await host.mockMouse.click(target!.bounds.x + 1, target!.bounds.y + 1, MouseButtons.LEFT);

    const after = await host.currentState();
    expect(after.selectedTargetIds).toContain(target!.id);
  });

  test("clicking a nested child renderable selects the child, not the parent", async () => {
    host = await buildTestHost({ addTargets: false });
    const outer = new BoxRenderable(host.renderer, {
      id: "outer-box",
      position: "absolute",
      left: 0,
      top: 0,
      width: 20,
      height: 10,
    });
    const inner = new BoxRenderable(host.renderer, {
      id: "inner-box",
      position: "absolute",
      left: 4,
      top: 2,
      width: 8,
      height: 4,
    });
    outer.add(inner);
    host.renderer.root.add(outer);
    await host.renderOnce();

    host.mockInput.pressKey("g", { ctrl: true });

    const before = await host.currentState();
    const innerTarget = before.targets.find((t) => t.metadata?.identifier === "inner-box");
    const outerTarget = before.targets.find((t) => t.metadata?.identifier === "outer-box");
    expect(innerTarget).toBeDefined();
    expect(outerTarget).toBeDefined();

    await host.mockMouse.click(
      innerTarget!.bounds.x + 1,
      innerTarget!.bounds.y + 1,
      MouseButtons.LEFT,
    );

    const after = await host.currentState();
    expect(after.selectedTargetIds).toContain(innerTarget!.id);
    expect(after.selectedTargetIds).not.toContain(outerTarget!.id);
  });

  test("clicking a deeply-nested non-text child selects the deepest child", async () => {
    host = await buildTestHost({ addTargets: false });
    const outer = new BoxRenderable(host.renderer, {
      id: "outer-box",
      position: "absolute",
      left: 0,
      top: 0,
      width: 30,
      height: 15,
    });
    const middle = new BoxRenderable(host.renderer, {
      id: "middle-box",
      position: "absolute",
      left: 2,
      top: 2,
      width: 20,
      height: 10,
    });
    const inner = new BoxRenderable(host.renderer, {
      id: "inner-box",
      position: "absolute",
      left: 4,
      top: 4,
      width: 10,
      height: 5,
    });
    outer.add(middle);
    middle.add(inner);
    host.renderer.root.add(outer);
    await host.renderOnce();

    host.mockInput.pressKey("g", { ctrl: true });

    const before = await host.currentState();
    const innerTarget = before.targets.find((t) => t.metadata?.identifier === "inner-box");
    expect(innerTarget).toBeDefined();

    await host.mockMouse.click(
      innerTarget!.bounds.x + 1,
      innerTarget!.bounds.y + 1,
      MouseButtons.LEFT,
    );

    const after = await host.currentState();
    expect(after.selectedTargetIds).toEqual([innerTarget!.id]);
  });
});

describe("makeCaptureHostLayer — hover inspector", () => {
  let host: Awaited<ReturnType<typeof buildTestHost>> | undefined;

  afterEach(async () => {
    await host?.dispose();
    host = undefined;
  });

  test("entering capture mode mounts an inspector populated with target info", async () => {
    host = await buildTestHost();
    host.mockInput.pressKey("g", { ctrl: true });

    expect(findInspector(host)).toBeDefined();
    const content = readInspectorText(host) ?? "";
    // Title is renderable type or componentName; both are non-empty strings.
    expect(content.length).toBeGreaterThan(0);
    expect(content.split("\n")[0]?.length).toBeGreaterThan(0);
  });

  test("mouse move over a target updates inspector content to that target", async () => {
    host = await buildTestHost({ addTargets: false });
    const outer = new BoxRenderable(host.renderer, {
      id: "outer-box",
      position: "absolute",
      left: 0,
      top: 0,
      width: 20,
      height: 10,
    });
    const inner = new BoxRenderable(host.renderer, {
      id: "inner-box",
      position: "absolute",
      left: 4,
      top: 2,
      width: 8,
      height: 4,
    });
    outer.add(inner);
    host.renderer.root.add(outer);
    await host.renderOnce();

    host.mockInput.pressKey("g", { ctrl: true });

    const before = await host.currentState();
    const innerTarget = before.targets.find((t) => t.metadata?.identifier === "inner-box");
    expect(innerTarget).toBeDefined();

    await host.mockMouse.moveTo(innerTarget!.bounds.x + 1, innerTarget!.bounds.y + 1);

    const after = await host.currentState();
    // Hover must NOT change currentIndex or selection.
    expect(after.currentIndex).toBe(before.currentIndex);
    expect(after.selectedTargetIds).toEqual(before.selectedTargetIds);

    const text = readInspectorText(host) ?? "";
    expect(text).toContain("#inner-box");
  });

  test("inspector renderables are not discoverable as capture targets", async () => {
    host = await buildTestHost();
    host.mockInput.pressKey("g", { ctrl: true });

    const state = await host.currentState();
    const inspectorIds = state.targets
      .map((t) => t.metadata?.identifier)
      .filter((id): id is string => typeof id === "string");
    expect(inspectorIds.some((id) => id.startsWith("anscribe-inspector-"))).toBe(false);
  });

  test("inspector container is stamped as an Anscribe overlay", async () => {
    host = await buildTestHost();
    host.mockInput.pressKey("g", { ctrl: true });

    const inspector = findInspector(host);
    expect(inspector).toBeDefined();
    expect(isAnscribeOverlay(inspector)).toBe(true);
  });

  test("exiting capture mode removes the inspector renderable", async () => {
    host = await buildTestHost();
    host.mockInput.pressKey("g", { ctrl: true });
    expect(findInspector(host)).toBeDefined();

    host.mockInput.pressEscape();

    expect(findInspector(host)).toBeUndefined();
  });
});

describe("makeCaptureHostLayer — persistence and failure reporting", () => {
  let host: Awaited<ReturnType<typeof buildTestHost>> | undefined;

  afterEach(async () => {
    await host?.dispose();
    host = undefined;
  });

  test("CommitDraft with body + current target invokes CapturePersistence", async () => {
    host = await buildTestHost();
    host.mockInput.pressKey("g", { ctrl: true });
    host.mockInput.pressTab(); // place the cursor on the first target so StartDraft has a fallback
    host.mockInput.pressKey("a"); // StartDraft — falls back to currentTarget when no explicit selection

    // Keystrokes flow into the focused InputRenderable natively; the host
    // only sees the final body via the input's ENTER event.
    for (const ch of "fixme") {
      host.mockInput.pressKey(ch);
    }
    host.mockInput.pressEnter();

    const persistenceState = host.persistenceState;
    await host.dispose();
    host = undefined;

    expect(persistenceState.captures.length).toBe(1);
    expect(persistenceState.captures[0]?.instruction).toBe("fixme");
    expect(persistenceState.captures[0]?.targets.length).toBe(1);
  });

  test("word-delete + retype: input value matches what the user sees, no duplication", async () => {
    host = await buildTestHost();
    host.mockInput.pressKey("g", { ctrl: true });
    host.mockInput.pressTab();
    host.mockInput.pressKey("a");

    for (const ch of "hello world") {
      host.mockInput.pressKey(ch);
    }
    // ctrl+w deletes the trailing word — InputRenderable handles this natively;
    // the host never intercepted it before the refactor, so its mirrored body
    // would diverge and "world" would resurrect on the next keystroke.
    host.mockInput.pressKey("w", { ctrl: true });
    for (const ch of "there") {
      host.mockInput.pressKey(ch);
    }
    host.mockInput.pressEnter();

    const persistenceState = host.persistenceState;
    await host.dispose();
    host = undefined;

    expect(persistenceState.captures[0]?.instruction).toBe("hello there");
  });

  test("CapturePersistence failure is routed to CaptureHostFailureReporter", async () => {
    host = await buildTestHost();
    host.persistenceState.fail = new CaptureValidationError({
      message: "test forced failure",
      detail: "test detail",
    });

    host.mockInput.pressKey("g", { ctrl: true });
    host.mockInput.pressTab();
    host.mockInput.pressKey("a");

    for (const ch of "fail") {
      host.mockInput.pressKey(ch);
    }
    host.mockInput.pressEnter();

    const failures = host.failures;
    await host.dispose(); // finalizer awaits pending persistence
    host = undefined;

    expect(failures.length).toBeGreaterThan(0);
  });
});
