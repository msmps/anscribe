import { describe, expect, it } from "vitest";
import type { CapturedTarget } from "@anscribe/core";
import { formatInspectorLines } from "../../src/inspector";

const target = (overrides: Partial<CapturedTarget> = {}): CapturedTarget =>
  ({
    id: "tid" as CapturedTarget["id"],
    type: "BoxRenderable",
    bounds: { x: 0, y: 0, width: 10, height: 3 },
    ancestry: ["Root"],
    ...overrides,
  }) as CapturedTarget;

describe("formatInspectorLines", () => {
  it("uses type for the title when no componentName is enriched", () => {
    const lines = formatInspectorLines(target({ type: "InputRenderable" }));
    expect(lines[0]).toBe("InputRenderable");
  });

  it("prefers componentName over type for the title", () => {
    const lines = formatInspectorLines(
      target({ type: "BoxRenderable", metadata: { componentName: "SaveButton" } }),
    );
    expect(lines[0]).toBe("SaveButton");
  });

  it("surfaces the renderable type on line 2 when line 1 used componentName", () => {
    const lines = formatInspectorLines(
      target({ type: "BoxRenderable", metadata: { componentName: "SaveButton" } }),
    );
    expect(lines[1]).toBe("BoxRenderable");
  });

  it("prefers identifier (when distinct) over visibleContent for line 2", () => {
    const lines = formatInspectorLines(
      target({
        metadata: { identifier: "save-btn" },
        visibleContent: "Save",
      }),
    );
    expect(lines[1]).toBe("#save-btn");
  });

  it("falls back to visibleContent on line 2 when no identifier is present", () => {
    const lines = formatInspectorLines(target({ visibleContent: "Save" }));
    expect(lines[1]).toBe('"Save"');
  });

  it("collapses whitespace and truncates long visibleContent", () => {
    const lines = formatInspectorLines(
      target({
        visibleContent: "  a\n  longer\tstring that exceeds the inspector preview limit  ",
      }),
    );
    expect(lines[1]?.startsWith('"a longer string')).toBe(true);
    expect(lines[1]?.endsWith('…"')).toBe(true);
  });

  it("renders the first source reference as basename + line (drops dir + column)", () => {
    const lines = formatInspectorLines(
      target({
        sourceReferences: [
          { file: "/abs/path/to/src/Foo.tsx", line: 12, column: 4 },
          { file: "src/Other.tsx", line: 1 },
        ] as CapturedTarget["sourceReferences"],
      }),
    );
    expect(lines.at(-1)).toBe("Foo.tsx:12");
  });

  it("renders the basename even when no line is known", () => {
    const lines = formatInspectorLines(
      target({
        sourceReferences: [{ file: "/abs/path/to/Foo.tsx" }] as CapturedTarget["sourceReferences"],
      }),
    );
    expect(lines.at(-1)).toBe("Foo.tsx");
  });

  it("does not include a bounds line — coordinates aren't useful to the user", () => {
    const lines = formatInspectorLines(target({ bounds: { x: 4, y: 8, width: 12, height: 3 } }));
    expect(lines.some((line) => /^x:\d+ y:\d+ w:\d+ h:\d+$/.test(line))).toBe(false);
  });

  it("omits the source-reference line when there's no source file", () => {
    const lines = formatInspectorLines(target({}));
    expect(lines.every((line) => !line.includes(".tsx"))).toBe(true);
  });
});
