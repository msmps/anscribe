// Side-effect re-export. The preload's source of truth lives in
// `@anscribe/react/preload` so non-OpenTUI host adapters (Ink, future React-tree
// TUI adapters) can share the same enricher; this subpath is the
// OpenTUI-discoverable alias users should import.
//
// MUST be imported before `@opentui/react` (or any React renderer) so the
// React DevTools hook is installed before React reads it.
import "@anscribe/react/preload";
