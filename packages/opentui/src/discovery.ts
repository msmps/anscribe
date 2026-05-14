import {
  CapturedTarget,
  decodeAnscribeDataEffect,
  generateCapturedTargetId,
  isAnscribeOverlay,
  noCaptureEnrichment,
  type CaptureEnrichmentOutput,
  type CaptureMetadata,
  type CaptureMetadataEnricher,
  type SourceReference,
  type TerminalCellBounds,
} from "@anscribe/core";
import { Effect } from "effect";
import {
  asRenderableRecord,
  isRenderableVisible,
  readFiniteNumber,
  readRenderableType,
  walkRenderableTree,
  type RenderableRecord,
} from "./renderable-tree";

export interface DiscoverVisibleTargetsOptions {
  metadataEnricher?: CaptureMetadataEnricher;
}

export const discoverVisibleTargets = Effect.fn("Discovery.discoverVisibleTargets")(function* (
  rootRenderable: unknown,
  options: DiscoverVisibleTargetsOptions,
) {
  const candidates: Array<{
    readonly renderable: RenderableRecord;
    readonly ancestry: readonly string[];
  }> = [];

  walkRenderableTree(
    rootRenderable,
    (renderable, ancestry) => {
      if (!isRenderableVisible(renderable)) {
        return;
      }

      candidates.push({ renderable, ancestry });
    },
    { shouldSkipSubtree: isAnscribeOverlay },
  );

  return yield* Effect.forEach(candidates, ({ renderable, ancestry }) =>
    Effect.gen(function* () {
      const visibleContent = readVisibleContent(renderable);
      const id = yield* generateCapturedTargetId;
      const target = yield* decodeAnscribeDataEffect(CapturedTarget, {
        id,
        type: readRenderableType(renderable),
        bounds: readBounds(renderable),
        ancestry,
        ...(visibleContent != null && { visibleContent }),
      });
      const enrichment = yield* readEnrichment(options, renderable, target);

      return enrichment === undefined
        ? target
        : yield* decodeAnscribeDataEffect(CapturedTarget, {
            ...target,
            ...(enrichment.metadata !== undefined && { metadata: enrichment.metadata }),
            ...(enrichment.sourceReferences !== undefined && {
              sourceReferences: enrichment.sourceReferences,
            }),
          });
    }),
  );
});

function readBounds(renderable: RenderableRecord): TerminalCellBounds {
  return {
    x: readFiniteNumber(renderable.screenX),
    y: readFiniteNumber(renderable.screenY),
    width: readFiniteNumber(renderable.width),
    height: readFiniteNumber(renderable.height),
  };
}

function readVisibleContent(renderable: RenderableRecord): string | undefined {
  const content = renderable.plainText ?? renderable.content ?? renderable.title;

  const text = stringifyVisibleContent(content);

  return text.length > 0 ? text : undefined;
}

function stringifyVisibleContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  const chunks = asRenderableRecord(content)?.chunks;

  if (Array.isArray(chunks)) {
    return chunks
      .map((chunk) => asRenderableRecord(chunk)?.text)
      .filter((text): text is string => typeof text === "string")
      .join("");
  }

  return "";
}

function readEnrichment(
  options: DiscoverVisibleTargetsOptions,
  renderable: RenderableRecord,
  target: CapturedTarget,
): Effect.Effect<CaptureEnrichmentOutput | undefined> {
  return Effect.gen(function* () {
    const enriched = yield* (
      options.metadataEnricher?.({ renderable, target }) ?? noCaptureEnrichment
    );
    const identifier = readRenderableIdentifier(renderable);
    const metadata: CaptureMetadata | undefined =
      enriched?.metadata === undefined && identifier === undefined
        ? undefined
        : {
            ...enriched?.metadata,
            ...(identifier !== undefined ? { identifier } : {}),
          };
    const sourceReferences: readonly SourceReference[] | undefined = enriched?.sourceReferences;
    const hasSources = sourceReferences !== undefined && sourceReferences.length > 0;

    if (metadata === undefined && !hasSources) {
      return undefined;
    }

    return {
      ...(metadata !== undefined && { metadata }),
      ...(hasSources && { sourceReferences }),
    };
  });
}

function readRenderableIdentifier(renderable: RenderableRecord): string | undefined {
  const identifier = renderable.id;

  return typeof identifier === "string" && identifier.length > 0 ? identifier : undefined;
}
