export interface ParsedFrame {
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly functionName?: string;
}

const V8_FRAME = /^\s*at\s+(?:(.+?)\s+)?\(?(.+?):(\d+):(\d+)\)?\s*$/;
const WEBKIT_FRAME = /^(?:(.+?)@)?(.+?):(\d+):(\d+)$/;

// Filter out anscribe's own internal frames so they don't pollute application
// Source References. Covers (a) published `node_modules/@anscribe/<name>/dist/`
// via `node_modules/`, (b) `@anscribe/<name>/{src,bin}/` if source-mapped, and
// (c) dev paths in this monorepo (`packages/<name>/{src,bin}/`). Adapter
// names are enumerated to avoid collisions with user-monorepo `packages/foo/`
// paths.
const REJECT_PATH =
  /(?:node_modules\/|@anscribe\/[a-z-]+\/(?:dist|src|bin)\/|\/packages\/(?:core|react|opentui|mcp|ink)\/(?:src|bin)\/)/;
const REJECT_FN = /^(?:react-stack-bottom-frame|runWithFiberInDEV|commitMount|commitWork)$/;

// Discriminator for a React-package-shaped path tail after `/<name>/`. Matches
// canonical bundle directories (`cjs/`, `umd/`, `esm/`, `dist/`, `build/`,
// `lib/`) or a bare package entry file (`index.js` / `.mjs` / `.cjs`). A user
// directory named `react/src/...` does not match; a vendored React install
// rooted at `react/cjs/react.development.js` does.
const REACT_PACKAGE_BUNDLE_TAIL = /^(?:cjs|umd|esm|dist|build|lib)\/|^index\.[mc]?js(?:$|\/)/;

const PREFIX_REGEX =
  /^(?:webpack-internal:\/{2,3}|webpack:\/{2,3}|turbopack:\/{2,3}|bun:\/{2,3}|node:)/;

const knownReactPackageNames = new Set<string>([
  "react",
  "react-dom",
  "react-reconciler",
  "scheduler",
]);

export function recordReactRendererPackageName(name: unknown): void {
  if (typeof name !== "string" || name.length === 0) return;
  knownReactPackageNames.add(name);
}

export function parseStackFrame(frame: string): ParsedFrame | undefined {
  const trimmed = frame.trim();
  if (trimmed.length === 0) return undefined;

  const v8 = V8_FRAME.exec(trimmed);
  if (v8 !== null) {
    return makeParsedFrame(v8[1], v8[2], v8[3], v8[4]);
  }

  const webkit = WEBKIT_FRAME.exec(trimmed);
  if (webkit !== null) {
    return makeParsedFrame(webkit[1], webkit[2], webkit[3], webkit[4]);
  }

  return undefined;
}

export function cleanSourcePath(path: string): string {
  let cleaned = path;
  cleaned = cleaned.replace(PREFIX_REGEX, "");
  if (cleaned.startsWith("file://")) {
    cleaned = cleaned.slice("file://".length);
    try {
      cleaned = decodeURIComponent(cleaned);
    } catch {
      // malformed percent-encoding falls through with the path unchanged.
    }
  }
  if (cleaned.startsWith("./")) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.startsWith("~/")) {
    cleaned = cleaned.slice(2);
  }
  const queryIndex = cleaned.search(/[?#]/);
  if (queryIndex !== -1) {
    cleaned = cleaned.slice(0, queryIndex);
  }
  return cleaned;
}

export function isApplicationFrame(path: string, functionName: string | undefined): boolean {
  if (path.length === 0) return false;
  // Bun synthesises pseudo-paths like `native`, `[native code]`, and bare
  // module identifiers for engine-internal frames; reject anything that
  // does not look like a real file path with a separator.
  if (!path.includes("/") && !path.includes("\\")) return false;
  if (containsKnownReactPackageSegment(path)) return false;
  if (REJECT_PATH.test(path)) return false;
  if (functionName !== undefined && REJECT_FN.test(functionName)) return false;
  return true;
}

function makeParsedFrame(
  rawFunctionName: string | undefined,
  rawFile: string | undefined,
  rawLine: string | undefined,
  rawColumn: string | undefined,
): ParsedFrame | undefined {
  if (rawFile === undefined || rawFile.length === 0) return undefined;
  const file = cleanSourcePath(rawFile);
  if (file.length === 0) return undefined;
  const line = rawLine === undefined ? undefined : safeParseInt(rawLine);
  const column = rawColumn === undefined ? undefined : safeParseInt(rawColumn);
  const functionName =
    rawFunctionName !== undefined && rawFunctionName.length > 0 ? rawFunctionName : undefined;

  return {
    file,
    ...(line !== undefined && { line }),
    ...(column !== undefined && { column }),
    ...(functionName !== undefined && { functionName }),
  };
}

function safeParseInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function containsKnownReactPackageSegment(path: string): boolean {
  const normalised = path.replace(/\\/g, "/");
  for (const name of knownReactPackageNames) {
    const marker = `/${name}/`;
    const idx = normalised.indexOf(marker);
    if (idx === -1) continue;
    // Hyphenated identifiers (`react-dom`, `react-reconciler`,
    // `react-native-renderer`, ...) are unambiguous as path segments.
    if (name.includes("-")) return true;
    // Single-word identifiers (`react`, `scheduler`) collide with user folder
    // conventions (`examples/react/src/index.tsx`). Require the tail after
    // `/<name>/` to look like a published React package layout.
    const tail = normalised.slice(idx + marker.length);
    if (REACT_PACKAGE_BUNDLE_TAIL.test(tail)) return true;
  }
  return false;
}
