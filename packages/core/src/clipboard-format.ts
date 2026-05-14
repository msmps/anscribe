import type { Capture, CapturedTarget } from "./schema";

const VISIBLE_CONTENT_PREVIEW_LIMIT = 200;

export function formatCaptureForClipboard(capture: Capture): string {
  const blocks: string[] = [];

  if (capture.instruction !== undefined && capture.instruction.length > 0) {
    blocks.push(capture.instruction);
  }

  for (const target of capture.targets) {
    blocks.push(formatTarget(target));
  }

  return blocks.join("\n\n");
}

function formatTarget(target: CapturedTarget): string {
  const lines = [formatTargetHeader(target), ...formatTargetAncestry(target)];
  return lines.join("\n");
}

function formatTargetHeader(target: CapturedTarget): string {
  const identifier = target.metadata?.identifier;
  const idAttr = identifier !== undefined ? ` id="${identifier}"` : "";
  const preview = formatVisibleContent(target.visibleContent);
  const suffix = preview !== undefined ? ` ${preview}` : "";
  return `<${target.type}${idAttr}>${suffix}`;
}

function formatVisibleContent(content: string | undefined): string | undefined {
  if (content === undefined) return undefined;
  const collapsed = content.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return undefined;

  const truncated =
    collapsed.length > VISIBLE_CONTENT_PREVIEW_LIMIT
      ? `${collapsed.slice(0, VISIBLE_CONTENT_PREVIEW_LIMIT - 1)}…`
      : collapsed;
  return `"${truncated}"`;
}

function formatTargetAncestry(target: CapturedTarget): string[] {
  const sourceReferences = target.sourceReferences ?? [];
  if (sourceReferences.length > 0) {
    return sourceReferences
      .map(formatSourceReferenceLine)
      .filter((line): line is string => line !== undefined);
  }

  const componentPath = target.metadata?.componentPath;
  if (componentPath !== undefined && componentPath.length > 0) {
    return componentPath
      .split(" > ")
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
      .map((name) => `  in ${name}`);
  }

  return [];
}

function formatSourceReferenceLine(reference: {
  readonly componentName?: string;
  readonly file?: string;
  readonly line?: number;
}): string | undefined {
  const name = reference.componentName ?? "<anonymous>";
  const location = formatSourceLocation(reference.file, reference.line);
  if (location === undefined && reference.componentName === undefined) {
    return undefined;
  }
  return location !== undefined ? `  in ${name} (at ${location})` : `  in ${name}`;
}

function formatSourceLocation(
  file: string | undefined,
  line: number | undefined,
): string | undefined {
  if (file === undefined) return undefined;
  return line !== undefined ? `${file}:${line}` : file;
}
