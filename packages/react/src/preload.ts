import {
  markReactMetadataEnricherRegistered,
  markReactRendererInjected,
  recordReactCommitRoot,
  setReactCurrentDispatcherRef,
} from "./fiber-pipeline";
import { recordReactRendererPackageName } from "./source-frames";

type ReactDevToolsRenderer = Record<string, unknown>;

type ReactDevToolsHook = {
  supportsFiber?: boolean;
  hasUnsupportedRendererAttached?: boolean;
  renderers?: Map<number, ReactDevToolsRenderer>;
  inject?: (renderer: ReactDevToolsRenderer) => number;
  onCommitFiberRoot?: (
    rendererId: number,
    root: unknown,
    priorityLevel?: unknown,
    didError?: unknown,
  ) => void;
  onScheduleFiberRoot?: (rendererId: number, root: unknown, children: unknown) => void;
  onPostCommitFiberRoot?: (rendererId: number, root: unknown) => void;
  onCommitFiberUnmount?: (rendererId: number, fiber: unknown) => void;
  checkDCE?: (fn: unknown) => void;
  on?: (...args: unknown[]) => void;
  off?: (...args: unknown[]) => void;
  sub?: (...args: unknown[]) => () => void;
  [key: symbol]: true | undefined;
};

declare global {
  // eslint-disable-next-line no-var
  var __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook | undefined;
}

const PATCHED = Symbol.for("anscribe.react.preload.patched");
const ENRICHER_REGISTERED = Symbol.for("anscribe.react.preload.enricherRegistered");
const noop = () => {};

installReactPreloadHook();

export function installReactPreloadHook(): ReactDevToolsHook {
  const hook = getOrCreateHook();

  if (hook[PATCHED] === true) {
    registerReactMetadataEnricher(hook);

    return hook;
  }

  hook[PATCHED] = true;
  registerReactMetadataEnricher(hook);
  hook.supportsFiber = true;
  hook.hasUnsupportedRendererAttached = false;
  hook.renderers ??= new Map();
  for (const renderer of hook.renderers.values()) {
    markReactRendererInjected();
    captureDispatcherRef(renderer);
  }
  hook.on ??= noop;
  hook.off ??= noop;
  hook.sub ??= () => noop;
  hook.checkDCE ??= noop;
  hook.onCommitFiberUnmount ??= noop;
  hook.onPostCommitFiberRoot ??= noop;
  hook.onScheduleFiberRoot ??= noop;

  const originalInject = hook.inject;
  let nextRendererId = Math.max(0, ...hook.renderers.keys());

  hook.inject = (renderer) => {
    const rendererId = originalInject?.call(hook, renderer) ?? ++nextRendererId;

    hook.renderers?.set(rendererId, renderer);
    markReactRendererInjected();
    captureDispatcherRef(renderer);

    return rendererId;
  };

  const originalOnCommitFiberRoot = hook.onCommitFiberRoot;

  hook.onCommitFiberRoot = (rendererId, root, priorityLevel, didError) => {
    recordReactCommitRoot(root);
    originalOnCommitFiberRoot?.call(hook, rendererId, root, priorityLevel, didError);
  };

  return hook;
}

function captureDispatcherRef(renderer: ReactDevToolsRenderer): void {
  const ref = (renderer as { currentDispatcherRef?: unknown }).currentDispatcherRef;
  setReactCurrentDispatcherRef(ref);
  const name = (renderer as { rendererPackageName?: unknown }).rendererPackageName;
  recordReactRendererPackageName(name);
}

function registerReactMetadataEnricher(hook: ReactDevToolsHook): void {
  if (hook[ENRICHER_REGISTERED] === true) {
    return;
  }

  hook[ENRICHER_REGISTERED] = true;
  markReactMetadataEnricherRegistered();
}

function getOrCreateHook(): ReactDevToolsHook {
  const existingHook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;

  if (existingHook !== undefined) {
    return existingHook;
  }

  // No default `inject`: installReactPreloadHook always overwrites hook.inject
  // with the recording wrapper, so a default would be dead code.
  const hook: ReactDevToolsHook = {
    supportsFiber: true,
    hasUnsupportedRendererAttached: false,
    renderers: new Map(),
    on: noop,
    off: noop,
    sub: () => noop,
    onCommitFiberRoot: noop,
    onScheduleFiberRoot: noop,
    onCommitFiberUnmount: noop,
    onPostCommitFiberRoot: noop,
    checkDCE: noop,
  };

  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;

  return hook;
}
