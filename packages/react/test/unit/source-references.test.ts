import { describe, expect, it } from "vitest";
import { extractSourceReferences, type ReactFiberLike } from "../../src/fiber-pipeline";

// `extractSourceReferences` walks six source-of-truth strategies in priority order:
//   1. fiber._debugStack
//   2. fiber._debugOwner chain → owner._debugStack
//   3. fiber._debugOwner chain → owner._debugSource
//   4. fiber.memoizedProps.__source (JSX runtime)
//   5. fiber._debugInfo[].stack OR _debugInfo[].owner._debugSource
//   6. probeComponentSource(fiber.type) (dispatcher hijack)
//
// Each test isolates one strategy by leaving the higher-priority fields undefined.
// Module-scope state in this module: a probeCache WeakMap keyed by component
// function references — each test uses fresh functions, so no leakage.

const V8_STACK = (file: string, line = 5, col = 3, fnName = "MyComp") =>
  `Error: marker\n    at ${fnName} (${file}:${line}:${col})`;

describe("extractSourceReferences — strategy 1: fiber._debugStack", () => {
  it("returns the first application frame from a string _debugStack", () => {
    const fiber: ReactFiberLike = {
      _debugStack: V8_STACK("src/widget.tsx", 7, 4, "Widget"),
    };
    const refs = extractSourceReferences(fiber);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.file).toBe("src/widget.tsx");
    expect(refs[0]?.line).toBe(7);
    expect(refs[0]?.column).toBe(4);
    expect(refs[0]?.functionName).toBe("Widget");
    expect(refs[0]?.origin).toBe("react-debug-stack");
  });

  it("accepts an Error instance as _debugStack", () => {
    const error = new Error("marker");
    // Overwrite stack to be deterministic across runtimes
    error.stack = V8_STACK("src/error-stack.tsx");
    const fiber: ReactFiberLike = { _debugStack: error };
    const refs = extractSourceReferences(fiber);
    expect(refs[0]?.origin).toBe("react-debug-stack");
    expect(refs[0]?.file).toBe("src/error-stack.tsx");
  });

  it("accepts an object with a .stack string property as _debugStack", () => {
    const fiber: ReactFiberLike = {
      _debugStack: { stack: V8_STACK("src/obj-stack.tsx") },
    };
    const refs = extractSourceReferences(fiber);
    expect(refs[0]?.origin).toBe("react-debug-stack");
    expect(refs[0]?.file).toBe("src/obj-stack.tsx");
  });

  it("skips frames that fail isApplicationFrame", () => {
    // Only frame is in anscribe internals — should be rejected and we fall
    // through to the no-strategy-found path.
    const fiber: ReactFiberLike = {
      _debugStack: `Error\n    at fn (/repo/packages/react/src/fiber-pipeline.ts:1:1)`,
    };
    expect(extractSourceReferences(fiber)).toEqual([]);
  });
});

describe("extractSourceReferences — strategy 2: owner._debugStack chain", () => {
  it("walks up the owner chain to find a stack and uses owner.type for componentName", () => {
    const owner: ReactFiberLike = {
      _debugStack: V8_STACK("src/owner.tsx", 11, 2, "InternalFn"),
      type: { displayName: "OwnerDisplay" },
    };
    const fiber: ReactFiberLike = { _debugOwner: owner };
    const refs = extractSourceReferences(fiber);
    expect(refs[0]?.origin).toBe("react-debug-owner-stack");
    expect(refs[0]?.file).toBe("src/owner.tsx");
    expect(refs[0]?.componentName).toBe("OwnerDisplay");
  });

  it("falls back from a leaf owner with no useful stack to a deeper owner", () => {
    const root: ReactFiberLike = {
      _debugStack: V8_STACK("src/root-owner.tsx"),
      type: () => null,
    };
    Object.defineProperty(root.type as object, "name", { value: "RootOwner" });
    const middle: ReactFiberLike = { _debugOwner: root }; // no stack
    const fiber: ReactFiberLike = { _debugOwner: middle };
    const refs = extractSourceReferences(fiber);
    expect(refs[0]?.origin).toBe("react-debug-owner-stack");
    expect(refs[0]?.file).toBe("src/root-owner.tsx");
    expect(refs[0]?.componentName).toBe("RootOwner");
  });
});

describe("extractSourceReferences — strategy 3: owner._debugSource (legacy)", () => {
  it("reads fileName/lineNumber/columnNumber from owner._debugSource", () => {
    const owner: ReactFiberLike = {
      _debugSource: {
        fileName: "/repo/src/legacy.tsx",
        lineNumber: 42,
        columnNumber: 6,
      },
      type: "Legacy",
    };
    const fiber: ReactFiberLike = { _debugOwner: owner };
    const refs = extractSourceReferences(fiber);
    expect(refs[0]?.origin).toBe("react-debug-owner");
    expect(refs[0]?.file).toBe("/repo/src/legacy.tsx");
    expect(refs[0]?.line).toBe(42);
    expect(refs[0]?.column).toBe(6);
    expect(refs[0]?.componentName).toBe("Legacy");
  });

  it("ignores _debugSource entries with missing or non-string fileName", () => {
    const owner: ReactFiberLike = {
      _debugSource: { fileName: "" },
    };
    const fiber: ReactFiberLike = { _debugOwner: owner };
    expect(extractSourceReferences(fiber)).toEqual([]);
  });
});

describe("extractSourceReferences — strategy 4: memoizedProps.__source (JSX runtime)", () => {
  it("reads __source from memoizedProps and tags origin jsx-runtime-source", () => {
    const fiber: ReactFiberLike = {
      memoizedProps: {
        __source: {
          fileName: "src/jsx.tsx",
          lineNumber: 9,
          columnNumber: 1,
        },
      },
    };
    const refs = extractSourceReferences(fiber);
    expect(refs[0]?.origin).toBe("jsx-runtime-source");
    expect(refs[0]?.file).toBe("src/jsx.tsx");
    expect(refs[0]?.line).toBe(9);
    expect(refs[0]?.column).toBe(1);
  });

  it("derives componentName from __self.constructor.name when present", () => {
    class TheComponent {}
    const selfInstance = new TheComponent();
    const fiber: ReactFiberLike = {
      memoizedProps: {
        __source: { fileName: "src/jsx-self.tsx", lineNumber: 1, columnNumber: 1 },
        __self: selfInstance,
      },
    };
    const refs = extractSourceReferences(fiber);
    expect(refs[0]?.componentName).toBe("TheComponent");
  });

  it("ignores __source with empty fileName", () => {
    const fiber: ReactFiberLike = {
      memoizedProps: { __source: { fileName: "" } },
    };
    expect(extractSourceReferences(fiber)).toEqual([]);
  });
});

describe("extractSourceReferences — strategy 5: _debugInfo", () => {
  it("reads first matching stack entry from _debugInfo[]", () => {
    const fiber: ReactFiberLike = {
      _debugInfo: [{ name: "InfoComp", stack: V8_STACK("src/info.tsx", 3, 1, "InfoFn") }],
    };
    const refs = extractSourceReferences(fiber);
    expect(refs[0]?.origin).toBe("react-debug-info");
    expect(refs[0]?.file).toBe("src/info.tsx");
    expect(refs[0]?.componentName).toBe("InfoComp");
  });

  it("falls back to _debugInfo[].owner._debugSource when no stack entry hits", () => {
    const fiber: ReactFiberLike = {
      _debugInfo: [
        {
          owner: {
            _debugSource: {
              fileName: "src/info-owner.tsx",
              lineNumber: 17,
              columnNumber: 0,
            },
            type: "OwnerName",
          },
        },
      ],
    };
    const refs = extractSourceReferences(fiber);
    expect(refs[0]?.origin).toBe("react-debug-info");
    expect(refs[0]?.file).toBe("src/info-owner.tsx");
    expect(refs[0]?.componentName).toBe("OwnerName");
  });

  it("returns empty when no _debugInfo entry yields a usable frame", () => {
    const fiber: ReactFiberLike = { _debugInfo: [{ irrelevant: true }] };
    expect(extractSourceReferences(fiber)).toEqual([]);
  });
});

describe("extractSourceReferences — strategy 6: dispatcher probe fallback", () => {
  // The probe runs the function with the dispatcher hijacked. With no
  // currentDispatcherRef set in this test file's module-scope state (fresh per
  // file), the probe will bail early via locateDispatcherSlot() → undefined.
  // The probe result is cached per function reference.

  it("returns empty when there are no debug fields and the probe bails", () => {
    function NoDebugFields(): null {
      return null;
    }
    const fiber: ReactFiberLike = { type: NoDebugFields };
    expect(extractSourceReferences(fiber)).toEqual([]);
  });

  it("caches null probe results per component function (idempotent calls)", () => {
    function CachedNoDebug(): null {
      return null;
    }
    const fiber: ReactFiberLike = { type: CachedNoDebug };
    // Two calls; cache prevents re-probing. We can't directly observe the cache,
    // but we pin the contract that successive calls return the same empty result.
    expect(extractSourceReferences(fiber)).toEqual([]);
    expect(extractSourceReferences(fiber)).toEqual([]);
  });

  it("returns empty when fiber.type is not unwrappable to a function", () => {
    const fiber: ReactFiberLike = { type: { someObject: true } };
    expect(extractSourceReferences(fiber)).toEqual([]);
  });
});

describe("extractSourceReferences — strategy precedence", () => {
  it("prefers _debugStack over owner-chain stacks", () => {
    const owner: ReactFiberLike = {
      _debugStack: V8_STACK("src/owner-only.tsx"),
      type: "Owner",
    };
    const fiber: ReactFiberLike = {
      _debugStack: V8_STACK("src/fiber-direct.tsx"),
      _debugOwner: owner,
    };
    const refs = extractSourceReferences(fiber);
    expect(refs[0]?.origin).toBe("react-debug-stack");
    expect(refs[0]?.file).toBe("src/fiber-direct.tsx");
  });

  it("prefers owner._debugStack over owner._debugSource", () => {
    const owner: ReactFiberLike = {
      _debugStack: V8_STACK("src/owner-stack.tsx"),
      _debugSource: {
        fileName: "src/owner-legacy-source.tsx",
        lineNumber: 1,
        columnNumber: 1,
      },
      type: "Owner",
    };
    const fiber: ReactFiberLike = { _debugOwner: owner };
    expect(extractSourceReferences(fiber)[0]?.origin).toBe("react-debug-owner-stack");
  });

  it("prefers owner._debugSource over memoizedProps.__source", () => {
    const owner: ReactFiberLike = {
      _debugSource: {
        fileName: "src/owner-legacy.tsx",
        lineNumber: 1,
        columnNumber: 1,
      },
      type: "Owner",
    };
    const fiber: ReactFiberLike = {
      _debugOwner: owner,
      memoizedProps: {
        __source: { fileName: "src/jsx-source.tsx", lineNumber: 1, columnNumber: 1 },
      },
    };
    expect(extractSourceReferences(fiber)[0]?.origin).toBe("react-debug-owner");
  });

  it("prefers memoizedProps.__source over _debugInfo", () => {
    const fiber: ReactFiberLike = {
      memoizedProps: {
        __source: { fileName: "src/jsx.tsx", lineNumber: 1, columnNumber: 1 },
      },
      _debugInfo: [{ stack: V8_STACK("src/info.tsx") }],
    };
    expect(extractSourceReferences(fiber)[0]?.origin).toBe("jsx-runtime-source");
  });

  it("prefers _debugInfo over the dispatcher probe", () => {
    function FallbackProbe(): null {
      return null;
    }
    const fiber: ReactFiberLike = {
      type: FallbackProbe,
      _debugInfo: [{ stack: V8_STACK("src/info-pref.tsx") }],
    };
    expect(extractSourceReferences(fiber)[0]?.origin).toBe("react-debug-info");
  });
});
