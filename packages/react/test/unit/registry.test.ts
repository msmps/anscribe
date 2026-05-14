import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  isReactRuntimeEnrichmentAvailable,
  markReactMetadataEnricherRegistered,
  markReactRendererInjected,
  reactMetadataEnricher,
  recordReactCommitRoot,
} from "../../src/fiber-pipeline";
import type { CapturedTarget } from "@anscribe/core";

interface FakeRenderable {
  readonly getChildren?: () => ReadonlyArray<unknown>;
  readonly screenX?: number;
}

const renderable = (overrides: FakeRenderable = {}): Record<string, unknown> => ({
  getChildren: overrides.getChildren ?? (() => []),
  screenX: overrides.screenX ?? 0,
});

interface FakeFiber {
  stateNode?: unknown;
  type?: unknown;
  elementType?: unknown;
  child?: FakeFiber | null;
  sibling?: FakeFiber | null;
  return?: FakeFiber | null;
  memoizedProps?: unknown;
}

const fiberRoot = (current: FakeFiber): { current: FakeFiber } => ({ current });

const dummyTarget = {} as unknown as CapturedTarget;

const namedFunction = (name: string): (() => null) => {
  const fn = (): null => null;
  Object.defineProperty(fn, "name", { value: name });
  return fn;
};

describe("reactMetadataEnricher", () => {
  it.effect("returns undefined for a renderable never recorded by recordReactCommitRoot", () =>
    Effect.gen(function* () {
      const result = yield* reactMetadataEnricher({
        renderable: renderable(),
        target: dummyTarget,
      });
      expect(result).toBeUndefined();
    }),
  );

  it.effect("returns undefined for non-object renderables", () =>
    Effect.gen(function* () {
      const result = yield* reactMetadataEnricher({
        renderable: "not-an-object",
        target: dummyTarget,
      });
      expect(result).toBeUndefined();
    }),
  );
});

describe("recordReactCommitRoot", () => {
  it("records metadata for renderables whose fiber has a function-typed ancestor", () => {
    const renderableNode = renderable();
    const root: FakeFiber = {
      stateNode: null,
      child: {
        stateNode: null,
        type: namedFunction("App"),
        child: {
          stateNode: renderableNode,
          type: "host-string-type-is-skipped",
          return: undefined,
        },
      },
    };
    // Wire the `return` parent pointers so the walk-up resolves componentPath.
    root.child!.child!.return = root.child!;
    root.child!.return = root;

    recordReactCommitRoot(fiberRoot(root.child!));

    return Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* reactMetadataEnricher({
          renderable: renderableNode,
          target: dummyTarget,
        });
        expect(result?.metadata).toEqual({
          componentName: "App",
          componentPath: "App",
        });
        expect(result).not.toHaveProperty("sourceReferences");
      }),
    );
  });

  it("walks fiber.return ancestors only, excluding the renderable-bearing fiber's own type", () => {
    // Real-React shape: the renderable-bearing fiber is a HOST fiber (type = string
    // for the custom renderer). Component names come from FUNCTION-typed ancestors.
    const renderableNode = renderable();
    const host: FakeFiber = {
      stateNode: renderableNode,
      type: "host-renderable",
    };
    const inner: FakeFiber = {
      stateNode: null,
      type: namedFunction("Inner"),
      child: host,
    };
    const middle: FakeFiber = {
      stateNode: null,
      type: namedFunction("Middle"),
      child: inner,
    };
    const outer: FakeFiber = {
      stateNode: null,
      type: namedFunction("Outer"),
      child: middle,
    };
    host.return = inner;
    inner.return = middle;
    middle.return = outer;

    recordReactCommitRoot(fiberRoot(outer));

    return Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* reactMetadataEnricher({
          renderable: renderableNode,
          target: dummyTarget,
        });
        // path = ancestors walked upward then reversed → ["Outer", "Middle", "Inner"]
        // componentName = path.at(-1) = "Inner" (the closest function ancestor)
        expect(result?.metadata).toEqual({
          componentName: "Inner",
          componentPath: "Outer > Middle > Inner",
        });
      }),
    );
  });

  it("skips internal component names (ErrorBoundary, Context.Provider, Provider)", () => {
    const renderableNode = renderable();
    const host: FakeFiber = {
      stateNode: renderableNode,
      type: "host-renderable",
    };
    const buttonRow: FakeFiber = {
      stateNode: null,
      type: namedFunction("ButtonRow"),
      child: host,
    };
    const providerFiber: FakeFiber = {
      stateNode: null,
      type: namedFunction("Context.Provider"),
      child: buttonRow,
    };
    const errorBoundary: FakeFiber = {
      stateNode: null,
      type: namedFunction("ErrorBoundary"),
      child: providerFiber,
    };
    const app: FakeFiber = {
      stateNode: null,
      type: namedFunction("App"),
      child: errorBoundary,
    };
    host.return = buttonRow;
    buttonRow.return = providerFiber;
    providerFiber.return = errorBoundary;
    errorBoundary.return = app;

    recordReactCommitRoot(fiberRoot(app));

    return Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* reactMetadataEnricher({
          renderable: renderableNode,
          target: dummyTarget,
        });
        // Context.Provider + ErrorBoundary are filtered from the chain.
        expect(result?.metadata).toEqual({
          componentName: "ButtonRow",
          componentPath: "App > ButtonRow",
        });
      }),
    );
  });

  it("prefers elementType displayName over function name", () => {
    const renderableNode = renderable();
    const innerFn = namedFunction("inner");
    const memo: Record<string, unknown> = { displayName: "MemoizedThing", type: innerFn };
    const leaf: FakeFiber = {
      stateNode: renderableNode,
      type: innerFn,
    };
    const owner: FakeFiber = {
      stateNode: null,
      elementType: memo,
      type: memo,
      child: leaf,
    };
    leaf.return = owner;

    recordReactCommitRoot(fiberRoot(owner));

    return Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* reactMetadataEnricher({
          renderable: renderableNode,
          target: dummyTarget,
        });
        expect(result?.metadata?.componentName).toBe("MemoizedThing");
      }),
    );
  });

  it("walks siblings and records each renderable independently", () => {
    const renderableA = renderable();
    const renderableB = renderable();
    const hostA: FakeFiber = { stateNode: renderableA, type: "host-renderable" };
    const hostB: FakeFiber = { stateNode: renderableB, type: "host-renderable" };
    const childA: FakeFiber = {
      stateNode: null,
      type: namedFunction("A"),
      child: hostA,
    };
    const childB: FakeFiber = {
      stateNode: null,
      type: namedFunction("B"),
      child: hostB,
    };
    childA.sibling = childB;
    const parent: FakeFiber = {
      stateNode: null,
      type: namedFunction("Parent"),
      child: childA,
    };
    hostA.return = childA;
    hostB.return = childB;
    childA.return = parent;
    childB.return = parent;

    recordReactCommitRoot(fiberRoot(parent));

    return Effect.runPromise(
      Effect.gen(function* () {
        const a = yield* reactMetadataEnricher({
          renderable: renderableA,
          target: dummyTarget,
        });
        const b = yield* reactMetadataEnricher({
          renderable: renderableB,
          target: dummyTarget,
        });
        expect(a?.metadata).toEqual({ componentName: "A", componentPath: "Parent > A" });
        expect(b?.metadata).toEqual({ componentName: "B", componentPath: "Parent > B" });
      }),
    );
  });

  it("records any object stateNode (framework-agnostic — discovery decides which renderables matter)", () => {
    // Pinned: we no longer probe the stateNode for OpenTUI-shaped fields. Any
    // non-null object is recorded; the host's discovery walker is the source
    // of truth for which renderables get looked up. Function-component fibers
    // (stateNode = null) are still filtered — see the other tests.
    const anyObject = { foo: "bar" };
    const leaf: FakeFiber = {
      stateNode: anyObject,
      type: namedFunction("Naive"),
    };
    const parent: FakeFiber = {
      stateNode: null,
      type: namedFunction("Parent"),
      child: leaf,
    };
    leaf.return = parent;

    recordReactCommitRoot(fiberRoot(parent));

    return Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* reactMetadataEnricher({
          renderable: anyObject,
          target: dummyTarget,
        });
        expect(result?.metadata).toEqual({ componentName: "Parent", componentPath: "Parent" });
      }),
    );
  });

  it("skips renderables whose ancestor chain yields no componentName", () => {
    const renderableNode = renderable();
    // Leaf with NO function/string ancestor — string types resolve to undefined name,
    // class component prototype contains isReactComponent so prototype branch is also skipped.
    const leaf: FakeFiber = {
      stateNode: renderableNode,
      type: "div",
    };
    // No `return` chain → readComponentPath returns empty → componentName === undefined
    recordReactCommitRoot(fiberRoot(leaf));

    return Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* reactMetadataEnricher({
          renderable: renderableNode,
          target: dummyTarget,
        });
        expect(result).toBeUndefined();
      }),
    );
  });

  it("propagates source references from memoizedProps.__source", () => {
    const renderableNode = renderable();
    const leaf: FakeFiber = {
      stateNode: renderableNode,
      type: namedFunction("WithSource"),
      memoizedProps: {
        __source: { fileName: "src/widget.tsx", lineNumber: 42, columnNumber: 6 },
      },
    };
    const parent: FakeFiber = {
      stateNode: null,
      type: namedFunction("Parent"),
      child: leaf,
    };
    leaf.return = parent;

    recordReactCommitRoot(fiberRoot(parent));

    return Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* reactMetadataEnricher({
          renderable: renderableNode,
          target: dummyTarget,
        });
        expect(result?.sourceReferences).toHaveLength(1);
        expect(result?.sourceReferences?.[0]?.file).toBe("src/widget.tsx");
        expect(result?.sourceReferences?.[0]?.line).toBe(42);
        expect(result?.sourceReferences?.[0]?.column).toBe(6);
        expect(result?.sourceReferences?.[0]?.origin).toBe("jsx-runtime-source");
      }),
    );
  });

  it("ignores roots that are not objects", () => {
    recordReactCommitRoot(null);
    recordReactCommitRoot(undefined);
    recordReactCommitRoot("not a root");
    recordReactCommitRoot(42);
  });

  it("ignores roots whose .current is null/undefined", () => {
    recordReactCommitRoot({ current: null });
    recordReactCommitRoot({ current: undefined });
    recordReactCommitRoot({});
  });
});

describe("isReactRuntimeEnrichmentAvailable + mark*", () => {
  // Module-scope flags are write-once `true`. We pin the boolean AND semantics
  // by toggling both flags via their setters and asserting the conjunction.
  // The "fresh = false" case must run before any other test in this file calls
  // a setter; because vitest preserves declaration order, that constraint is
  // already satisfied (no other suite above this one touches the setters).

  it("returns true once both flags are marked", () => {
    // Note: by the time this test runs, recordReactCommitRoot tests above
    // have NOT touched the flags. We can still observe the false → true
    // transition because no other suite has called the setters either.
    expect(isReactRuntimeEnrichmentAvailable()).toBe(false);

    markReactMetadataEnricherRegistered();
    expect(isReactRuntimeEnrichmentAvailable()).toBe(false);

    markReactRendererInjected();
    expect(isReactRuntimeEnrichmentAvailable()).toBe(true);
  });
});
