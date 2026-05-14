import { Context, Effect, Layer } from "effect";
import type { CapturedTarget, CaptureMetadata, SourceReference } from "./schema";

export interface CaptureEnrichmentOutput {
  readonly metadata?: CaptureMetadata;
  readonly sourceReferences?: readonly SourceReference[];
}

export const noCaptureEnrichment: Effect.Effect<CaptureEnrichmentOutput | undefined> =
  Effect.succeed(undefined as CaptureEnrichmentOutput | undefined);

export type CaptureMetadataEnricher = (input: {
  renderable: unknown;
  target: CapturedTarget;
}) => Effect.Effect<CaptureEnrichmentOutput | undefined>;

interface CaptureMetadataEnrichmentShape {
  readonly enrich: CaptureMetadataEnricher;
}

export class CaptureMetadataEnrichment extends Context.Service<
  CaptureMetadataEnrichment,
  CaptureMetadataEnrichmentShape
>()("anscribe/enrichment/CaptureMetadataEnrichment") {
  static readonly live = Layer.succeed(this, this.of({ enrich: () => noCaptureEnrichment }));
  static readonly layer = (enricher: CaptureMetadataEnricher) =>
    Layer.succeed(this, this.of({ enrich: enricher }));
}
