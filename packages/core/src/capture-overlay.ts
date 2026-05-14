// Marker symbol stamped on host-owned renderables so adapter discovery
// prunes them from capture targets. Framework-agnostic on purpose: each
// adapter mounts its own renderable types (BoxRenderable, Ink nodes, etc.)
// but they all check this shared symbol, which is registered via Symbol.for
// so multiple adapter bundles see the same identity.
export const ANSCRIBE_OVERLAY: unique symbol = Symbol.for("anscribe.captureOverlay");

export function markAsOverlay<R extends object>(renderable: R): R {
  Object.defineProperty(renderable, ANSCRIBE_OVERLAY, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return renderable;
}

export function isAnscribeOverlay(renderable: unknown): boolean {
  return (
    renderable !== null &&
    typeof renderable === "object" &&
    (renderable as { [ANSCRIBE_OVERLAY]?: unknown })[ANSCRIBE_OVERLAY] === true
  );
}
