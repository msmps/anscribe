import type { CapturedTarget, SourceReference } from "@anscribe/core";

// Visual configuration borrowed from the existing capture overlay palette so
// the inspector reads as part of the same surface as the instruction draft.
export const INSPECTOR_BORDER_COLOR = "#ffffff";
export const INSPECTOR_TEXT_COLOR = "#ffffff";
export const INSPECTOR_DIM_COLOR = "#777777";

export const INSPECTOR_WIDTH = 36;
export const INSPECTOR_MIN_HEIGHT = 3;

const VISIBLE_CONTENT_PREVIEW_LIMIT = 32;

export function formatInspectorLines(target: CapturedTarget): readonly string[] {
  const title = target.metadata?.componentName ?? target.type;
  const subtitle = readSubtitle(target);
  const sourceLine = formatSourceReference(target.sourceReferences?.[0]);

  return [title, subtitle, sourceLine].filter((line): line is string => line !== undefined);
}

function readSubtitle(target: CapturedTarget): string | undefined {
  const componentName = target.metadata?.componentName;
  const identifier = target.metadata?.identifier;

  // Avoid repeating the line-1 title on line 2.
  if (identifier !== undefined && identifier !== componentName) {
    return `#${identifier}`;
  }

  const preview = readVisibleContentPreview(target.visibleContent);
  if (preview !== undefined) return preview;

  // If line 1 used componentName, surface the renderable type on line 2 so the
  // user still sees the structural anchor.
  return componentName !== undefined ? target.type : undefined;
}

function readVisibleContentPreview(content: string | undefined): string | undefined {
  if (content === undefined) return undefined;

  const collapsed = content.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return undefined;

  const truncated =
    collapsed.length > VISIBLE_CONTENT_PREVIEW_LIMIT
      ? `${collapsed.slice(0, VISIBLE_CONTENT_PREVIEW_LIMIT - 1)}…`
      : collapsed;

  return `"${truncated}"`;
}

function formatSourceReference(reference: SourceReference | undefined): string | undefined {
  if (reference === undefined) return undefined;

  const { file, line } = reference;
  if (file === undefined) return undefined;

  const basename = file.slice(file.lastIndexOf("/") + 1);
  return line === undefined ? basename : `${basename}:${line}`;
}
