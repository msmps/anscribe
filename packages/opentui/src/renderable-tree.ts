export type RenderableRecord = Record<string, unknown>;

export function asRenderableRecord(value: unknown): RenderableRecord | undefined {
  return value !== null && typeof value === "object" ? (value as RenderableRecord) : undefined;
}

function readRenderableChildren(renderable: RenderableRecord): unknown[] {
  const opentuiChildren =
    typeof renderable.getChildren === "function" ? renderable.getChildren() : undefined;

  return Array.isArray(opentuiChildren) ? opentuiChildren : [];
}

export interface WalkRenderableTreeOptions {
  readonly shouldSkipSubtree?: (renderable: RenderableRecord) => boolean;
}

export function walkRenderableTree(
  rootRenderable: unknown,
  visit: (renderable: RenderableRecord, ancestry: readonly string[]) => void,
  options: WalkRenderableTreeOptions = {},
): void {
  const step = (value: unknown, ancestry: readonly string[]): void => {
    const renderable = asRenderableRecord(value);

    if (renderable === undefined) return;
    if (options.shouldSkipSubtree?.(renderable) === true) return;

    const nextAncestry = [...ancestry, readRenderableType(renderable)];
    visit(renderable, nextAncestry);

    for (const child of readRenderableChildren(renderable)) {
      step(child, nextAncestry);
    }
  };

  step(rootRenderable, []);
}

export function isRenderableVisible(renderable: RenderableRecord): boolean {
  return renderable.visible !== false;
}

export function readRenderableType(renderable: RenderableRecord): string {
  return readConstructorName(renderable.constructor) ?? "Renderable";
}

export function readFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readConstructorName(value: unknown): string | undefined {
  if (typeof value === "function") {
    return value.name.length > 0 ? value.name : undefined;
  }

  const name = asRenderableRecord(value)?.name;

  return typeof name === "string" && name.length > 0 ? name : undefined;
}
