import {
  SourceReference,
  type CaptureEnrichmentOutput,
  type CaptureMetadata,
  type CapturedTarget,
  type SourceReference as SourceReferenceType,
} from "@anscribe/core";
import { Effect } from "effect";
import {
  cleanSourcePath,
  isApplicationFrame,
  parseStackFrame,
  type ParsedFrame,
} from "./source-frames";

const REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref");
const REACT_MEMO_TYPE = Symbol.for("react.memo");
const REACT_LAZY_TYPE = Symbol.for("react.lazy");

export type ReactComponentFunction = ((props?: unknown) => unknown) & {
  readonly displayName?: unknown;
  readonly name: string;
  readonly prototype?: unknown;
};

export interface ReactFiberLike {
  readonly type?: unknown;
  readonly elementType?: unknown;
  readonly stateNode?: unknown;
  readonly child?: ReactFiberLike | null;
  readonly sibling?: ReactFiberLike | null;
  readonly return?: ReactFiberLike | null;
  readonly _debugStack?: unknown;
  readonly _debugOwner?: ReactFiberLike | null;
  readonly _debugInfo?: ReadonlyArray<unknown>;
  readonly _debugSource?: unknown;
  readonly memoizedProps?: unknown;
}

type ReactFiberRoot = {
  readonly current?: ReactFiberLike | null;
};

type ReactRenderableMetadata = Pick<CaptureMetadata, "componentName" | "componentPath">;

interface ReactRenderableEnrichment {
  readonly metadata: ReactRenderableMetadata;
  readonly sourceReferences: readonly SourceReferenceType[];
}

type DispatcherSlot =
  | { readonly root: Record<string, unknown>; readonly key: "H" }
  | { readonly root: Record<string, unknown>; readonly key: "current" };

type ProbeCacheEntry = { readonly ref: SourceReferenceType | null };

const ABORT_MESSAGE = "anscribe.dispatcher-probe.abort";

const DISPATCHER_PROXY = new Proxy(Object.create(null) as Record<PropertyKey, unknown>, {
  get() {
    throw new Error(ABORT_MESSAGE);
  },
});

const probeCache = new WeakMap<ReactComponentFunction, ProbeCacheEntry>();
const renderableEnrichment = new WeakMap<object, ReactRenderableEnrichment>();
let currentDispatcherRef: Record<string, unknown> | undefined;
let reactMetadataEnricherRegistered = false;
let reactRendererInjected = false;

export function markReactMetadataEnricherRegistered(): void {
  reactMetadataEnricherRegistered = true;
}

export function markReactRendererInjected(): void {
  reactRendererInjected = true;
}

export function isReactRuntimeEnrichmentAvailable(): boolean {
  return reactMetadataEnricherRegistered && reactRendererInjected;
}

export function reactMetadataEnricher(input: {
  renderable: unknown;
  target: CapturedTarget;
}): Effect.Effect<CaptureEnrichmentOutput | undefined> {
  return Effect.sync(() => {
    const enrichment = isObject(input.renderable)
      ? renderableEnrichment.get(input.renderable)
      : undefined;

    if (enrichment === undefined) return undefined;

    return enrichment.sourceReferences.length > 0
      ? { metadata: enrichment.metadata, sourceReferences: enrichment.sourceReferences }
      : { metadata: enrichment.metadata };
  });
}

export function recordReactCommitRoot(root: unknown): void {
  const current = isObject(root) ? (root as ReactFiberRoot).current : undefined;

  if (current === undefined || current === null) {
    return;
  }

  walkFiber(current);
}

function walkFiber(fiber: ReactFiberLike): void {
  recordFiber(fiber);

  if (fiber.child !== undefined && fiber.child !== null) {
    walkFiber(fiber.child);
  }

  if (fiber.sibling !== undefined && fiber.sibling !== null) {
    walkFiber(fiber.sibling);
  }
}

function recordFiber(fiber: ReactFiberLike): void {
  // Record any object stateNode. Function-component fibers have `stateNode`
  // `null` and are filtered here; class instances pass through but are
  // never looked up by discovery (which keys on host-renderer instances).
  // This shape stays framework-agnostic: a renderer's host nodes are always
  // non-null objects, regardless of OpenTUI vs Ink vs others.
  const renderable = fiber.stateNode;

  if (!isObject(renderable)) {
    return;
  }

  const componentPath = readComponentPath(fiber);
  const componentName = componentPath.at(-1);

  if (componentName === undefined) {
    return;
  }

  const sourceReferences = extractSourceReferences(fiber);

  renderableEnrichment.set(renderable, {
    metadata: {
      componentName,
      componentPath: componentPath.join(" > "),
    },
    sourceReferences,
  });
}

function readComponentPath(fiber: ReactFiberLike): string[] {
  const path: string[] = [];

  for (
    let current = fiber.return;
    current !== undefined && current !== null;
    current = current.return
  ) {
    const name = readComponentName(current);

    if (name !== undefined && !isInternalComponentName(name)) {
      path.push(name);
    }
  }

  return path.reverse();
}

function readComponentName(fiber: ReactFiberLike): string | undefined {
  const type = fiber.elementType ?? fiber.type;

  if (typeof type === "string") {
    return undefined;
  }

  if (typeof type === "function") {
    return readNamedFunction(type as ReactComponentFunction);
  }

  if (!isObject(type)) {
    return undefined;
  }

  const displayName = readString(type.displayName);

  if (displayName !== undefined) {
    return displayName;
  }

  const nestedType = type.type;

  if (typeof nestedType === "function") {
    return readNamedFunction(nestedType as ReactComponentFunction);
  }

  const render = type.render;

  if (typeof render === "function") {
    return readNamedFunction(render as ReactComponentFunction);
  }

  const contextDisplayName = isObject(type._context)
    ? readString(type._context.displayName)
    : undefined;

  return contextDisplayName === undefined ? undefined : `${contextDisplayName}.Provider`;
}

function readNamedFunction(fn: ReactComponentFunction): string | undefined {
  return readString((fn as { displayName?: unknown }).displayName) ?? readString(fn.name);
}

function isInternalComponentName(name: string): boolean {
  return (
    name === "ErrorBoundary" ||
    name === "AppContext.Provider" ||
    name === "Context.Provider" ||
    name === "Provider"
  );
}

export function extractSourceReferences(fiber: ReactFiberLike): readonly SourceReferenceType[] {
  const direct =
    readFromDebugStack(fiber) ??
    readFromOwnerDebugStack(fiber) ??
    readFromOwnerDebugSource(fiber) ??
    readFromJsxSource(fiber) ??
    readFromDebugInfo(fiber);
  if (direct !== undefined) return [direct];

  const componentFunction = unwrapReactComponentFunction(fiber.type);
  if (componentFunction === undefined) return [];

  const cached = probeCache.get(componentFunction);
  if (cached !== undefined) return cached.ref === null ? [] : [cached.ref];

  const probed = probeComponentSource(componentFunction) ?? null;
  probeCache.set(componentFunction, { ref: probed });
  return probed === null ? [] : [probed];
}

function readFromDebugStack(fiber: ReactFiberLike): SourceReferenceType | undefined {
  const raw = fiber._debugStack;
  const stack = stackToString(raw);
  if (stack === undefined) return undefined;
  const parsed = pickApplicationFrame(stack);
  if (parsed === undefined) return undefined;
  return makeSourceReference(parsed, "react-debug-stack");
}

function readFromOwnerDebugStack(fiber: ReactFiberLike): SourceReferenceType | undefined {
  let owner: ReactFiberLike | null | undefined = fiber._debugOwner;
  while (owner !== undefined && owner !== null) {
    const stack = stackToString(owner._debugStack);
    if (stack !== undefined) {
      const parsed = pickApplicationFrame(stack);
      if (parsed !== undefined) {
        const componentName = readComponentDisplayName(owner.type);
        return makeSourceReference(parsed, "react-debug-owner-stack", componentName);
      }
    }
    owner = owner._debugOwner;
  }
  return undefined;
}

function readFromOwnerDebugSource(fiber: ReactFiberLike): SourceReferenceType | undefined {
  let owner: ReactFiberLike | null | undefined = fiber._debugOwner;
  while (owner !== undefined && owner !== null) {
    const source = readSourceFields(owner._debugSource);
    if (source !== undefined) {
      const componentName = readComponentDisplayName(owner.type);
      return makeSourceReference(source, "react-debug-owner", componentName);
    }
    owner = owner._debugOwner;
  }
  return undefined;
}

function readFromJsxSource(fiber: ReactFiberLike): SourceReferenceType | undefined {
  const props = fiber.memoizedProps;
  if (!isObject(props)) return undefined;
  const parsed = readSourceFields((props as { __source?: unknown }).__source);
  if (parsed === undefined) return undefined;
  const selfConstructorName = readSelfConstructorName((props as { __self?: unknown }).__self);
  return makeSourceReference(parsed, "jsx-runtime-source", selfConstructorName);
}

function readFromDebugInfo(fiber: ReactFiberLike): SourceReferenceType | undefined {
  const info = fiber._debugInfo;
  if (!Array.isArray(info)) return undefined;
  for (const entry of info) {
    if (!isObject(entry)) continue;
    const stack = (entry as { stack?: unknown }).stack;
    if (typeof stack === "string" && stack.length > 0) {
      const parsed = pickApplicationFrame(stack);
      if (parsed !== undefined) {
        const componentName = readComponentDisplayName(
          (entry as { name?: unknown }).name ?? undefined,
        );
        return makeSourceReference(parsed, "react-debug-info", componentName);
      }
    }
    const owner = (entry as { owner?: unknown }).owner;
    if (isObject(owner)) {
      const source = readSourceFields((owner as ReactFiberLike)._debugSource);
      if (source !== undefined) {
        const componentName = readComponentDisplayName(
          (owner as ReactFiberLike).type ?? (entry as { name?: unknown }).name,
        );
        return makeSourceReference(source, "react-debug-info", componentName);
      }
    }
  }
  return undefined;
}

function stackToString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (value instanceof Error && typeof value.stack === "string") return value.stack;
  if (isObject(value) && typeof (value as { stack?: unknown }).stack === "string") {
    return (value as { stack: string }).stack;
  }
  return undefined;
}

function pickApplicationFrame(stack: string): ParsedFrame | undefined {
  for (const line of stack.split("\n")) {
    const parsed = parseStackFrame(line);
    if (parsed === undefined) continue;
    if (parsed.file === undefined) continue;
    if (!isApplicationFrame(parsed.file, parsed.functionName)) continue;
    return parsed;
  }
  return undefined;
}

function readSourceFields(raw: unknown): ParsedFrame | undefined {
  if (!isObject(raw)) return undefined;
  const fileName = (raw as { fileName?: unknown }).fileName;
  if (typeof fileName !== "string" || fileName.length === 0) return undefined;
  const cleaned = cleanSourcePath(fileName);
  if (cleaned.length === 0) return undefined;
  const lineNumber = (raw as { lineNumber?: unknown }).lineNumber;
  const columnNumber = (raw as { columnNumber?: unknown }).columnNumber;
  return {
    file: cleaned,
    ...(typeof lineNumber === "number" && Number.isFinite(lineNumber) && { line: lineNumber }),
    ...(typeof columnNumber === "number" &&
      Number.isFinite(columnNumber) && { column: columnNumber }),
  };
}

function readSelfConstructorName(value: unknown): string | undefined {
  if (!isObject(value)) return undefined;
  const ctor = (value as { constructor?: unknown }).constructor;
  if (typeof ctor !== "function") return undefined;
  const name = (ctor as { name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

function makeSourceReference(
  parsed: ParsedFrame,
  origin: string,
  componentName?: string,
): SourceReferenceType {
  return new SourceReference({
    ...(parsed.file !== undefined && { file: parsed.file }),
    ...(parsed.line !== undefined && { line: parsed.line }),
    ...(parsed.column !== undefined && { column: parsed.column }),
    ...(parsed.functionName !== undefined && { functionName: parsed.functionName }),
    ...(componentName !== undefined && { componentName }),
    origin,
  });
}

// Dispatcher-probe fallback: only reached when no debug fields are present.
// Reads the component's source by invoking it under a proxy dispatcher that
// throws on first hook access, then parses the thrown stack for an
// application-frame. Speculative; cached per component function.
export function unwrapReactComponentFunction(value: unknown): ReactComponentFunction | undefined {
  let current: unknown = value;
  const seen = new Set<unknown>();

  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);

    if (typeof current === "function") {
      return current as ReactComponentFunction;
    }

    if (typeof current !== "object") {
      return undefined;
    }

    const wrapper = current as Record<string, unknown>;

    if (wrapper.$$typeof === REACT_FORWARD_REF_TYPE) {
      current = wrapper.render;
      continue;
    }

    if (wrapper.$$typeof === REACT_MEMO_TYPE) {
      current = wrapper.type;
      continue;
    }

    if (wrapper.$$typeof === REACT_LAZY_TYPE) {
      const init = wrapper._init;

      if (typeof init !== "function") {
        return undefined;
      }

      try {
        current = (init as (payload: unknown) => unknown)(wrapper._payload);
        continue;
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  return undefined;
}

/**
 * Record the `currentDispatcherRef` that the React reconciler hands to
 * `__REACT_DEVTOOLS_GLOBAL_HOOK__.inject`. That object is the live
 * `ReactSharedInternals` of the React instance the application renders with,
 * so reading the dispatcher slot from it always targets the right copy of
 * React even when more than one is resolvable on disk.
 *
 * @internal
 */
export function setReactCurrentDispatcherRef(ref: unknown): void {
  if (isObject(ref)) {
    currentDispatcherRef = ref;
  }
}

export function probeComponentSource(
  componentFunction: ReactComponentFunction,
): SourceReferenceType | undefined {
  if (isClassComponent(componentFunction)) return undefined;

  const inner = unwrapReactComponentFunction(componentFunction);
  if (inner === undefined) return undefined;

  const slot = locateDispatcherSlot();
  if (slot === undefined) return undefined;

  const original = slot.root[slot.key];
  slot.root[slot.key] = DISPATCHER_PROXY;
  let stack: string | undefined;
  try {
    inner({});
  } catch (error) {
    stack = error instanceof Error && typeof error.stack === "string" ? error.stack : undefined;
  } finally {
    slot.root[slot.key] = original;
  }

  if (stack === undefined) return undefined;

  for (const line of stack.split("\n")) {
    const parsed = parseStackFrame(line);
    if (parsed === undefined || parsed.file === undefined) continue;
    if (!isApplicationFrame(parsed.file, parsed.functionName)) continue;

    return new SourceReference({
      file: parsed.file,
      ...(parsed.line !== undefined && { line: parsed.line }),
      ...(parsed.column !== undefined && { column: parsed.column }),
      ...(parsed.functionName !== undefined && { functionName: parsed.functionName }),
      origin: "dispatcher-probe",
    });
  }

  return undefined;
}

function isClassComponent(value: ReactComponentFunction): boolean {
  const prototype = value.prototype;
  if (prototype === null || typeof prototype !== "object") return false;
  return (prototype as { isReactComponent?: unknown }).isReactComponent !== undefined;
}

function locateDispatcherSlot(): DispatcherSlot | undefined {
  const ref = currentDispatcherRef;
  if (ref === undefined) return undefined;
  if ("H" in ref) {
    return { root: ref, key: "H" };
  }
  const legacyDispatcher = (ref as { ReactCurrentDispatcher?: unknown }).ReactCurrentDispatcher;
  if (isObject(legacyDispatcher) && "current" in legacyDispatcher) {
    return {
      root: legacyDispatcher,
      key: "current",
    };
  }
  return undefined;
}

function readComponentDisplayName(type: unknown): string | undefined {
  if (typeof type === "string" && type.length > 0) return type;
  if (typeof type === "function") {
    const fn = type as { displayName?: unknown; name?: unknown };
    if (typeof fn.displayName === "string" && fn.displayName.length > 0) return fn.displayName;
    if (typeof fn.name === "string" && fn.name.length > 0) return fn.name;
  }
  if (isObject(type)) {
    const obj = type as { displayName?: unknown };
    if (typeof obj.displayName === "string" && obj.displayName.length > 0) return obj.displayName;
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
