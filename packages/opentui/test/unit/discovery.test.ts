import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { markAsOverlay, SourceReference, type CaptureMetadataEnricher } from "@anscribe/core";
import { discoverVisibleTargets } from "../../src/discovery";

interface FakeRenderable {
  readonly id?: string;
  readonly visible?: boolean;
  readonly screenX?: number;
  readonly screenY?: number;
  readonly width?: number;
  readonly height?: number;
  readonly plainText?: string;
  readonly content?: unknown;
  readonly title?: string;
  readonly children?: ReadonlyArray<FakeRenderable>;
  readonly typeName?: string;
}

const renderable = (overrides: FakeRenderable = {}) => {
  // Mimic OpenTUI's class-based renderables by faking a constructor with a name.
  const typeName = overrides.typeName ?? "BoxRenderable";
  const fakeConstructor = { name: typeName };
  const node: Record<string, unknown> = {
    constructor: fakeConstructor,
    visible: overrides.visible ?? true,
    screenX: overrides.screenX ?? 0,
    screenY: overrides.screenY ?? 0,
    width: overrides.width ?? 10,
    height: overrides.height ?? 1,
    getChildren: () => overrides.children ?? [],
  };
  if (overrides.id !== undefined) node.id = overrides.id;
  if (overrides.plainText !== undefined) node.plainText = overrides.plainText;
  if (overrides.content !== undefined) node.content = overrides.content;
  if (overrides.title !== undefined) node.title = overrides.title;

  return node;
};

describe("discoverVisibleTargets", () => {
  it.effect("returns empty when root has no visible renderables", () =>
    Effect.gen(function* () {
      const targets = yield* discoverVisibleTargets(renderable({ visible: false }), {});
      expect(targets).toEqual([]);
    }),
  );

  it.effect("yields one target per visible renderable", () =>
    Effect.gen(function* () {
      const root = renderable({
        typeName: "RootRenderable",
        children: [renderable({ typeName: "BoxRenderable" })],
      });
      const targets = yield* discoverVisibleTargets(root, {});
      expect(targets).toHaveLength(2);
      expect(targets.map((t) => t.type)).toEqual(["RootRenderable", "BoxRenderable"]);
    }),
  );

  it.effect("excludes renderables where visible === false", () =>
    Effect.gen(function* () {
      const root = renderable({
        typeName: "RootRenderable",
        children: [
          renderable({ typeName: "VisibleChild" }),
          renderable({ typeName: "HiddenChild", visible: false }),
        ],
      });
      const targets = yield* discoverVisibleTargets(root, {});
      expect(targets.map((t) => t.type)).toEqual(["RootRenderable", "VisibleChild"]);
    }),
  );

  it.effect("populates bounds from screen coordinates", () =>
    Effect.gen(function* () {
      const root = renderable({ screenX: 5, screenY: 7, width: 12, height: 3 });
      const targets = yield* discoverVisibleTargets(root, {});
      expect(targets).toHaveLength(1);
      expect(targets[0]?.bounds).toEqual({ x: 5, y: 7, width: 12, height: 3 });
    }),
  );

  it.effect("captures ancestry chain in order", () =>
    Effect.gen(function* () {
      const root = renderable({
        typeName: "Root",
        children: [
          renderable({
            typeName: "Middle",
            children: [renderable({ typeName: "Leaf" })],
          }),
        ],
      });
      const targets = yield* discoverVisibleTargets(root, {});
      expect(targets.map((t) => Array.from(t.ancestry))).toEqual([
        ["Root"],
        ["Root", "Middle"],
        ["Root", "Middle", "Leaf"],
      ]);
    }),
  );

  it.effect("populates visibleContent from plainText", () =>
    Effect.gen(function* () {
      const root = renderable({ plainText: "hello world" });
      const targets = yield* discoverVisibleTargets(root, {});
      expect(targets[0]?.visibleContent).toBe("hello world");
    }),
  );

  it.effect("populates visibleContent from chunked content as fallback", () =>
    Effect.gen(function* () {
      const root = renderable({
        content: { chunks: [{ text: "foo" }, { text: "bar" }] },
      });
      const targets = yield* discoverVisibleTargets(root, {});
      expect(targets[0]?.visibleContent).toBe("foobar");
    }),
  );

  it.effect("omits visibleContent when no text source is present", () =>
    Effect.gen(function* () {
      const root = renderable({});
      const targets = yield* discoverVisibleTargets(root, {});
      expect(targets[0]).not.toHaveProperty("visibleContent");
    }),
  );

  it.effect("populates metadata.identifier when renderable.id is a non-empty string", () =>
    Effect.gen(function* () {
      const root = renderable({ id: "row-1" });
      const targets = yield* discoverVisibleTargets(root, {});
      expect(targets[0]?.metadata).toEqual({ identifier: "row-1" });
    }),
  );

  it.effect("applies enricher metadata and source references", () =>
    Effect.gen(function* () {
      const enricher: CaptureMetadataEnricher = () =>
        Effect.succeed({
          metadata: { componentName: "Toolbar" },
          sourceReferences: [new SourceReference({ file: "src/Toolbar.tsx", line: 7 })],
        });
      const root = renderable({ id: "row-1" });
      const targets = yield* discoverVisibleTargets(root, { metadataEnricher: enricher });
      expect(targets[0]?.metadata).toEqual({ identifier: "row-1", componentName: "Toolbar" });
      expect(targets[0]?.sourceReferences).toHaveLength(1);
      expect(targets[0]?.sourceReferences?.[0]?.file).toBe("src/Toolbar.tsx");
    }),
  );

  it.effect("omits metadata entirely when there's no identifier and no enrichment", () =>
    Effect.gen(function* () {
      const root = renderable({});
      const targets = yield* discoverVisibleTargets(root, {});
      expect(targets[0]).not.toHaveProperty("metadata");
      expect(targets[0]).not.toHaveProperty("sourceReferences");
    }),
  );

  it.effect("prunes Anscribe-marked overlay subtrees from discovery", () =>
    Effect.gen(function* () {
      const overlay = markAsOverlay(
        renderable({
          typeName: "AnscribeOverlay",
          children: [renderable({ typeName: "OverlayChild" })],
        }),
      );
      const root = renderable({
        typeName: "Root",
        children: [renderable({ typeName: "AppChild" }), overlay],
      });
      const targets = yield* discoverVisibleTargets(root, {});
      const types = targets.map((t) => t.type);
      expect(types).toContain("Root");
      expect(types).toContain("AppChild");
      expect(types).not.toContain("AnscribeOverlay");
      expect(types).not.toContain("OverlayChild");
    }),
  );
});
