#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Each publishable package's `LICENSE` is byte-synced from the repo root so we
// never publish a package without a license. READMEs are intentionally NOT
// synced: each package has a hand-written README describing its own surface
// (root README is marketing; per-package READMEs are API reference).

const ROOT = resolve(import.meta.dir, "..");
const PUBLISHABLE = ["packages/core", "packages/mcp", "packages/opentui", "packages/react"];
const SYNCED_FILES = ["LICENSE"];

const checkMode = process.argv.includes("--check");

let drift = false;
for (const pkg of PUBLISHABLE) {
  for (const file of SYNCED_FILES) {
    const expected = readFileSync(join(ROOT, file), "utf8");
    const dest = join(ROOT, pkg, file);
    if (checkMode) {
      if (!existsSync(dest) || readFileSync(dest, "utf8") !== expected) {
        console.error(`drift: ${pkg}/${file}`);
        drift = true;
      }
    } else {
      writeFileSync(dest, expected);
      console.log(`wrote ${pkg}/${file}`);
    }
  }
}

if (checkMode && drift) {
  console.error("Run `bun run sync:meta` to fix.");
  process.exit(1);
}
