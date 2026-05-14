import { describe, expect, it } from "vitest";
import {
  cleanSourcePath,
  isApplicationFrame,
  parseStackFrame,
  recordReactRendererPackageName,
} from "../../src/source-frames";

describe("parseStackFrame — V8 format", () => {
  it("parses 'at fn (file:line:col)' frames", () => {
    expect(parseStackFrame("    at myFn (src/file.ts:12:34)")).toEqual({
      file: "src/file.ts",
      line: 12,
      column: 34,
      functionName: "myFn",
    });
  });

  it("parses anonymous 'at file:line:col' frames (no functionName)", () => {
    expect(parseStackFrame("    at src/file.ts:12:34")).toEqual({
      file: "src/file.ts",
      line: 12,
      column: 34,
    });
  });

  it("parses qualified function names like 'Object.<anonymous>'", () => {
    const result = parseStackFrame("    at Object.<anonymous> (src/file.ts:1:1)");
    expect(result?.functionName).toBe("Object.<anonymous>");
    expect(result?.file).toBe("src/file.ts");
  });
});

describe("parseStackFrame — WebKit format", () => {
  it("parses 'fn@file:line:col' frames", () => {
    expect(parseStackFrame("myFn@src/file.ts:12:34")).toEqual({
      file: "src/file.ts",
      line: 12,
      column: 34,
      functionName: "myFn",
    });
  });

  it("parses 'file:line:col' (no functionName) frames", () => {
    expect(parseStackFrame("src/file.ts:12:34")).toEqual({
      file: "src/file.ts",
      line: 12,
      column: 34,
    });
  });
});

describe("parseStackFrame — edge cases", () => {
  it("returns undefined for blank lines", () => {
    expect(parseStackFrame("")).toBeUndefined();
    expect(parseStackFrame("   ")).toBeUndefined();
  });

  it("returns undefined for unparseable lines", () => {
    expect(parseStackFrame("Error: something went wrong")).toBeUndefined();
  });

  it("cleans prefixes during parsing (delegates to cleanSourcePath)", () => {
    const result = parseStackFrame("    at MyComp (webpack-internal:///./src/comp.tsx:7:1)");
    expect(result?.file).toBe("src/comp.tsx");
  });
});

describe("cleanSourcePath", () => {
  it("strips webpack-internal prefix", () => {
    expect(cleanSourcePath("webpack-internal:///./src/foo.ts")).toBe("src/foo.ts");
  });

  it("strips turbopack prefix", () => {
    expect(cleanSourcePath("turbopack:///src/foo.ts")).toBe("src/foo.ts");
  });

  it("strips bun:// prefix (two- or three-slash form, like webpack-internal/turbopack)", () => {
    expect(cleanSourcePath("bun://src/foo.ts")).toBe("src/foo.ts");
    expect(cleanSourcePath("bun:///src/foo.ts")).toBe("src/foo.ts");
  });

  it("strips node: prefix", () => {
    expect(cleanSourcePath("node:fs")).toBe("fs");
  });

  it("decodes file:// URLs", () => {
    expect(cleanSourcePath("file:///Users/me/code%20with%20spaces/file.ts")).toBe(
      "/Users/me/code with spaces/file.ts",
    );
  });

  it("leaves file:// URLs intact when decoding fails", () => {
    // Invalid percent-encoding: '%E0%A4%A' is malformed.
    const malformed = "file:///bad%E0%A4%A";
    expect(cleanSourcePath(malformed)).toBe("/bad%E0%A4%A");
  });

  it("strips leading './' and '~/'", () => {
    expect(cleanSourcePath("./src/foo.ts")).toBe("src/foo.ts");
    expect(cleanSourcePath("~/src/foo.ts")).toBe("src/foo.ts");
  });

  it("strips query strings and fragments", () => {
    expect(cleanSourcePath("src/foo.ts?import=1")).toBe("src/foo.ts");
    expect(cleanSourcePath("src/foo.ts#L10")).toBe("src/foo.ts");
  });
});

describe("isApplicationFrame — basic guards", () => {
  it("rejects empty paths", () => {
    expect(isApplicationFrame("", undefined)).toBe(false);
  });

  it("rejects paths without any directory separator (bun/v8 pseudo-paths)", () => {
    expect(isApplicationFrame("native", undefined)).toBe(false);
    expect(isApplicationFrame("[native code]", undefined)).toBe(false);
    expect(isApplicationFrame("bare-module", undefined)).toBe(false);
  });

  it("accepts plausible application paths", () => {
    expect(isApplicationFrame("src/app.tsx", "MyComp")).toBe(true);
    expect(isApplicationFrame("/abs/path/src/app.tsx", "MyComp")).toBe(true);
  });
});

describe("isApplicationFrame — rejected internals", () => {
  it("rejects node_modules paths", () => {
    expect(isApplicationFrame("node_modules/foo/index.js", undefined)).toBe(false);
    expect(isApplicationFrame("project/node_modules/foo/index.js", undefined)).toBe(false);
  });

  it("rejects published @anscribe/<pkg>/dist/ paths", () => {
    expect(isApplicationFrame("/repo/node_modules/@anscribe/core/dist/index.mjs", undefined)).toBe(
      false,
    );
    expect(
      isApplicationFrame("/repo/node_modules/@anscribe/react/dist/preload.mjs", undefined),
    ).toBe(false);
  });

  it("rejects @anscribe/<pkg>/src and bin paths (source-mapped published bundles)", () => {
    expect(isApplicationFrame("/repo/@anscribe/opentui/src/host.ts", undefined)).toBe(false);
    expect(isApplicationFrame("/repo/@anscribe/mcp/bin/anscribe-mcp.ts", undefined)).toBe(false);
  });

  it("rejects monorepo dev paths under packages/<adapter>/{src,bin}/", () => {
    expect(isApplicationFrame("/repo/packages/opentui/src/host.ts", undefined)).toBe(false);
    expect(isApplicationFrame("/repo/packages/react/src/fiber-pipeline.ts", undefined)).toBe(false);
    expect(isApplicationFrame("/repo/packages/mcp/bin/anscribe-mcp.ts", undefined)).toBe(false);
  });

  it("rejects engine-internal functionNames", () => {
    expect(isApplicationFrame("src/comp.tsx", "react-stack-bottom-frame")).toBe(false);
    expect(isApplicationFrame("src/comp.tsx", "runWithFiberInDEV")).toBe(false);
    expect(isApplicationFrame("src/comp.tsx", "commitMount")).toBe(false);
    expect(isApplicationFrame("src/comp.tsx", "commitWork")).toBe(false);
  });
});

describe("isApplicationFrame — React package detection", () => {
  it("rejects hyphenated React packages anywhere in the path", () => {
    expect(isApplicationFrame("/repo/foo/react-dom/anything/lib.js", undefined)).toBe(false);
    expect(isApplicationFrame("/repo/foo/react-reconciler/anything.js", undefined)).toBe(false);
  });

  it("rejects single-word React packages when the tail matches a known bundle layout", () => {
    expect(isApplicationFrame("/repo/foo/react/cjs/react.development.js", undefined)).toBe(false);
    expect(isApplicationFrame("/repo/foo/react/umd/react.production.min.js", undefined)).toBe(
      false,
    );
    expect(isApplicationFrame("/repo/foo/scheduler/dist/scheduler.development.js", undefined)).toBe(
      false,
    );
    expect(isApplicationFrame("/repo/foo/react/index.js", undefined)).toBe(false);
  });

  it("accepts user paths that contain 'react' as a folder name without a bundle tail", () => {
    // e.g. an examples directory: `examples/react/src/index.tsx`
    expect(isApplicationFrame("examples/react/src/index.tsx", "MyComp")).toBe(true);
  });
});

describe("recordReactRendererPackageName", () => {
  // The module-scope knownReactPackageNames Set is grow-only across this file.
  // We use a sentinel that no other test or test file uses.
  const SENTINEL = "test-only-renderer-sentinel";

  it("ignores non-string and empty inputs", () => {
    recordReactRendererPackageName(undefined);
    recordReactRendererPackageName(null);
    recordReactRendererPackageName(42);
    recordReactRendererPackageName("");
    // Nothing was added: a path containing none of the sentinels is still accepted.
    expect(isApplicationFrame("examples/my-renderer/src/app.tsx", undefined)).toBe(true);
  });

  it("records a hyphenated renderer name and rejects future paths under it", () => {
    expect(isApplicationFrame(`/repo/${SENTINEL}/internal.js`, undefined)).toBe(true);

    recordReactRendererPackageName(SENTINEL);

    expect(isApplicationFrame(`/repo/${SENTINEL}/internal.js`, undefined)).toBe(false);
  });

  it("is idempotent for already-known names", () => {
    recordReactRendererPackageName("react"); // already in the seed set
    recordReactRendererPackageName("react");
    expect(isApplicationFrame("/repo/react/cjs/react.development.js", undefined)).toBe(false);
  });
});
