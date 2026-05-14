import path from "node:path";
import { describe, expect, test } from "bun:test";

// Pins the fix for the dual-module-instance bug (2026-05-13). Anscribe's
// React enrichment keeps a module-scope WeakMap inside `fiber-pipeline.ts`.
// If `@anscribe/react/preload` (imported by the example app) and
// `@anscribe/react` (imported transitively via `@anscribe/opentui/react`)
// resolve to two different physical files, preload writes to one WeakMap
// and the enricher reads from another — metadata silently drops everything
// except `identifier`.
//
// The fix lives in tsconfig.base.json: paths are declared there so every
// package that extends base inherits the same source-resolution map. This
// test resolves `@anscribe/react` from two different anchor directories
// (one mirroring the example app, one mirroring the opentui package) and
// asserts both land on the exact same file on disk. If anyone removes the
// paths block from tsconfig.base.json (or splits dist/src resolution), the
// resolved paths diverge and this test fails.

const repoRoot = path.resolve(import.meta.dir, "../../../..");
const exampleAnchor = path.join(repoRoot, "examples/react");
const opentuiAnchor = path.join(repoRoot, "packages/opentui");

describe("@anscribe/react module resolution", () => {
  test("resolves to the same physical file from example apps and from packages/opentui", () => {
    const fromExample = Bun.resolveSync("@anscribe/react", exampleAnchor);
    const fromOpentui = Bun.resolveSync("@anscribe/react", opentuiAnchor);
    expect(fromExample).toBe(fromOpentui);
  });

  test("`@anscribe/react/preload` resolves to the same physical file from both anchors", () => {
    const fromExample = Bun.resolveSync("@anscribe/react/preload", exampleAnchor);
    const fromOpentui = Bun.resolveSync("@anscribe/react/preload", opentuiAnchor);
    expect(fromExample).toBe(fromOpentui);
  });
});

describe("@anscribe/opentui/react/preload subpath", () => {
  // The preload proxy is the recommended user-facing import path. Resolution
  // must be stable from both the consuming app and from packages/opentui
  // itself; if either anchor diverges, the example apps and the host adapter
  // can disagree about which physical file installs the React DevTools hook.
  test("`@anscribe/opentui/react/preload` resolves to the same physical file from both anchors", () => {
    const fromExample = Bun.resolveSync("@anscribe/opentui/react/preload", exampleAnchor);
    const fromOpentui = Bun.resolveSync("@anscribe/opentui/react/preload", opentuiAnchor);
    expect(fromExample).toBe(fromOpentui);
  });
});
