import { beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { CapturedTarget } from "@anscribe/core";
import { reactMetadataEnricher } from "../../src/fiber-pipeline";
import { installReactPreloadHook } from "../../src/preload";

// preload.ts side-effects at import time: it calls installReactPreloadHook(),
// which mutates globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__. Each test below
// resets the global hook before re-installing, so we observe a fresh patch
// cycle per test.

const PATCHED = Symbol.for("anscribe.react.preload.patched");
const ENRICHER_REGISTERED = Symbol.for("anscribe.react.preload.enricherRegistered");

type GlobalHookSlot = {
  __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown;
};

const resetGlobalHook = (): void => {
  delete (globalThis as unknown as GlobalHookSlot).__REACT_DEVTOOLS_GLOBAL_HOOK__;
};

beforeEach(() => {
  resetGlobalHook();
});

const dummyTarget = {} as unknown as CapturedTarget;
const fakeRenderable = (): Record<string, unknown> => ({
  getChildren: () => [],
  screenX: 0,
});

describe("installReactPreloadHook — default hook creation", () => {
  it("creates a fresh devtools hook on globalThis when none exists", () => {
    const hook = installReactPreloadHook();

    expect(hook).toBe((globalThis as unknown as GlobalHookSlot).__REACT_DEVTOOLS_GLOBAL_HOOK__);
    expect(hook.supportsFiber).toBe(true);
    expect(hook.hasUnsupportedRendererAttached).toBe(false);
    expect(hook.renderers).toBeInstanceOf(Map);
    expect(hook.renderers?.size).toBe(0);
    expect(typeof hook.inject).toBe("function");
    expect(typeof hook.onCommitFiberRoot).toBe("function");
    expect(typeof hook.onScheduleFiberRoot).toBe("function");
    expect(typeof hook.onPostCommitFiberRoot).toBe("function");
    expect(typeof hook.onCommitFiberUnmount).toBe("function");
    expect(typeof hook.on).toBe("function");
    expect(typeof hook.off).toBe("function");
    expect(typeof hook.sub).toBe("function");
    expect(typeof hook.checkDCE).toBe("function");
    expect(hook[PATCHED]).toBe(true);
    expect(hook[ENRICHER_REGISTERED]).toBe(true);
  });
});

describe("installReactPreloadHook — patching an existing partial hook", () => {
  it("fills in missing noop methods without overwriting existing ones", () => {
    const customOn = () => {};
    (globalThis as unknown as GlobalHookSlot).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      on: customOn,
    };

    const hook = installReactPreloadHook();

    expect(hook.on).toBe(customOn);
    expect(typeof hook.off).toBe("function");
    expect(typeof hook.sub).toBe("function");
    expect(typeof hook.checkDCE).toBe("function");
    expect(hook.supportsFiber).toBe(true);
    expect(hook.hasUnsupportedRendererAttached).toBe(false);
  });

  it("ensures hook.renderers is a Map even when missing", () => {
    (globalThis as unknown as GlobalHookSlot).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {};

    const hook = installReactPreloadHook();

    expect(hook.renderers).toBeInstanceOf(Map);
    expect(hook.renderers?.size).toBe(0);
  });

  it("preserves an existing renderers Map", () => {
    const renderers = new Map([[7, { id: "pre-existing" } as Record<string, unknown>]]);
    (globalThis as unknown as GlobalHookSlot).__REACT_DEVTOOLS_GLOBAL_HOOK__ = { renderers };

    const hook = installReactPreloadHook();

    expect(hook.renderers).toBe(renderers);
    expect(hook.renderers?.get(7)).toEqual({ id: "pre-existing" });
  });
});

describe("installReactPreloadHook — wrapped hook.inject", () => {
  it("records the injected renderer in hook.renderers", () => {
    const hook = installReactPreloadHook();
    const renderer = { rendererPackageName: "fake-renderer" };

    const rendererId = hook.inject?.(renderer);

    expect(typeof rendererId).toBe("number");
    expect(hook.renderers?.get(rendererId as number)).toBe(renderer);
  });

  it("delegates to the original hook.inject when present", () => {
    let originalCalls = 0;
    (globalThis as unknown as GlobalHookSlot).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      inject: () => {
        originalCalls++;
        return 42;
      },
    };

    const hook = installReactPreloadHook();
    const renderer = { name: "ren" };

    const id = hook.inject?.(renderer);

    expect(originalCalls).toBe(1);
    expect(id).toBe(42);
    expect(hook.renderers?.get(42)).toBe(renderer);
  });

  it("falls back to incrementing renderer IDs when no original inject is present", () => {
    const hook = installReactPreloadHook();

    const idA = hook.inject?.({ name: "A" });
    const idB = hook.inject?.({ name: "B" });

    expect(idA).toBe(1);
    expect(idB).toBe(2);
  });
});

describe("installReactPreloadHook — wrapped hook.onCommitFiberRoot", () => {
  it("delegates to the original onCommitFiberRoot when present", () => {
    let observedArgs: unknown[] | undefined;
    (globalThis as unknown as GlobalHookSlot).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      onCommitFiberRoot: (...args: unknown[]) => {
        observedArgs = args;
      },
    };

    const hook = installReactPreloadHook();
    hook.onCommitFiberRoot?.(1, { current: null }, "lane", false);

    expect(observedArgs).toEqual([1, { current: null }, "lane", false]);
  });

  it("walks the fiber tree via recordReactCommitRoot so reactMetadataEnricher sees the result", () => {
    const hook = installReactPreloadHook();

    // Build a minimal fiber tree: host fiber owns a renderable, function-typed
    // ancestor provides componentName.
    const renderable = fakeRenderable();
    const innerFn = (): null => null;
    Object.defineProperty(innerFn, "name", { value: "Inner" });

    const hostFiber: Record<string, unknown> = {
      stateNode: renderable,
      type: "host",
    };
    const innerFiber: Record<string, unknown> = {
      stateNode: null,
      type: innerFn,
      child: hostFiber,
    };
    hostFiber.return = innerFiber;

    hook.onCommitFiberRoot?.(0, { current: innerFiber });

    return Effect.runPromise(
      Effect.gen(function* () {
        const out = yield* reactMetadataEnricher({ renderable, target: dummyTarget });
        expect(out?.metadata).toEqual({
          componentName: "Inner",
          componentPath: "Inner",
        });
      }),
    );
  });
});

describe("installReactPreloadHook — idempotency via PATCHED symbol", () => {
  it("does not re-wrap inject or onCommitFiberRoot on a second call", () => {
    const hookA = installReactPreloadHook();
    const wrappedInject = hookA.inject;
    const wrappedOnCommit = hookA.onCommitFiberRoot;

    const hookB = installReactPreloadHook();

    expect(hookB).toBe(hookA);
    expect(hookB.inject).toBe(wrappedInject);
    expect(hookB.onCommitFiberRoot).toBe(wrappedOnCommit);
  });

  it("still calls registerReactMetadataEnricher on the early-return path (ENRICHER_REGISTERED stays true)", () => {
    const hook = installReactPreloadHook();
    expect(hook[ENRICHER_REGISTERED]).toBe(true);

    // Manually clear the symbol to simulate a fresh enricher state on a
    // previously-patched hook; verify the second install re-marks it.
    delete hook[ENRICHER_REGISTERED];
    installReactPreloadHook();

    expect(hook[ENRICHER_REGISTERED]).toBe(true);
  });
});

describe("installReactPreloadHook — pre-existing renderers", () => {
  it("does not lose pre-existing renderers; subsequent injections coexist", () => {
    const renderers = new Map([[3, { name: "early" } as Record<string, unknown>]]);
    (globalThis as unknown as GlobalHookSlot).__REACT_DEVTOOLS_GLOBAL_HOOK__ = { renderers };

    const hook = installReactPreloadHook();
    const newRendererId = hook.inject?.({ name: "later" });

    expect(hook.renderers?.get(3)).toEqual({ name: "early" });
    expect(typeof newRendererId).toBe("number");
    expect((newRendererId as number) > 3).toBe(true);
    expect(hook.renderers?.get(newRendererId as number)).toEqual({ name: "later" });
  });
});
