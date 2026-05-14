// Adapter-facing API. Consumers wiring an enricher Layer in a host adapter
// pull from here. End users import "@anscribe/react/preload" instead — it
// installs the React DevTools hook as a load-time side effect.
export { isReactRuntimeEnrichmentAvailable, reactMetadataEnricher } from "./fiber-pipeline";
