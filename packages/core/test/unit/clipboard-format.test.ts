import { describe, expect, it } from "vitest";
import {
  Capture,
  CaptureId,
  CapturedTarget,
  CapturedTargetId,
  CaptureMetadata,
  formatCaptureForClipboard,
  IsoTimestamp,
  SourceReference,
  TerminalCellBounds,
} from "@anscribe/core";

const bounds = new TerminalCellBounds({ x: 0, y: 0, width: 10, height: 1 });

const makeTarget = (overrides: {
  id?: string;
  type?: string;
  visibleContent?: string;
  metadata?: CaptureMetadata;
  sourceReferences?: ReadonlyArray<SourceReference>;
}) =>
  new CapturedTarget({
    id: CapturedTargetId.make(overrides.id ?? "target_default"),
    type: overrides.type ?? "BoxRenderable",
    bounds,
    ancestry: ["root"],
    ...(overrides.visibleContent !== undefined && { visibleContent: overrides.visibleContent }),
    ...(overrides.metadata !== undefined && { metadata: overrides.metadata }),
    ...(overrides.sourceReferences !== undefined && {
      sourceReferences: overrides.sourceReferences,
    }),
  });

const makeCapture = (overrides: {
  instruction?: string;
  targets?: ReadonlyArray<CapturedTarget>;
}) =>
  new Capture({
    id: CaptureId.make("capture_test"),
    status: "pending",
    createdAt: IsoTimestamp.make("2026-05-13T10:00:00.000Z"),
    ...(overrides.instruction !== undefined && { instruction: overrides.instruction }),
    targets: overrides.targets ?? [makeTarget({})],
  });

describe("formatCaptureForClipboard", () => {
  it("renders instruction body above the target block", () => {
    const capture = makeCapture({
      instruction: "fix this row",
      targets: [makeTarget({ id: "a", metadata: new CaptureMetadata({ identifier: "row-1" }) })],
    });
    expect(formatCaptureForClipboard(capture)).toBe(
      ["fix this row", "", '<BoxRenderable id="row-1">'].join("\n"),
    );
  });

  it("omits the instruction block when none is set", () => {
    const capture = makeCapture({
      targets: [makeTarget({ id: "a", metadata: new CaptureMetadata({ identifier: "row-1" }) })],
    });
    expect(formatCaptureForClipboard(capture)).toBe('<BoxRenderable id="row-1">');
  });

  it("includes the visible-content preview when present", () => {
    const capture = makeCapture({
      targets: [
        makeTarget({
          metadata: new CaptureMetadata({ identifier: "row-1" }),
          visibleContent: "Hello world",
        }),
      ],
    });
    expect(formatCaptureForClipboard(capture)).toBe('<BoxRenderable id="row-1"> "Hello world"');
  });

  it("collapses whitespace in the visible-content preview", () => {
    const capture = makeCapture({
      targets: [makeTarget({ visibleContent: "  Hello\n\n   world\t" })],
    });
    expect(formatCaptureForClipboard(capture)).toBe('<BoxRenderable> "Hello world"');
  });

  it("truncates very long visible content with an ellipsis", () => {
    const capture = makeCapture({
      targets: [makeTarget({ visibleContent: "x".repeat(300) })],
    });
    const result = formatCaptureForClipboard(capture);
    expect(result.endsWith('…"')).toBe(true);
    expect(result.length).toBeLessThan(300);
  });

  it("renders an 'in <Component> (at file:line)' line per source reference", () => {
    const capture = makeCapture({
      instruction: "needs a11y label",
      targets: [
        makeTarget({
          metadata: new CaptureMetadata({ identifier: "row-1" }),
          sourceReferences: [
            new SourceReference({
              componentName: "InboxRow",
              file: "src/InboxRow.tsx",
              line: 42,
            }),
            new SourceReference({
              componentName: "Inbox",
              file: "src/Inbox.tsx",
              line: 10,
            }),
          ],
        }),
      ],
    });
    expect(formatCaptureForClipboard(capture)).toBe(
      [
        "needs a11y label",
        "",
        '<BoxRenderable id="row-1">',
        "  in InboxRow (at src/InboxRow.tsx:42)",
        "  in Inbox (at src/Inbox.tsx:10)",
      ].join("\n"),
    );
  });

  it("falls back to componentPath when no sourceReferences are present", () => {
    const capture = makeCapture({
      targets: [
        makeTarget({
          metadata: new CaptureMetadata({
            identifier: "row-1",
            componentPath: "App > Toolbar > Row",
          }),
        }),
      ],
    });
    expect(formatCaptureForClipboard(capture)).toBe(
      ['<BoxRenderable id="row-1">', "  in App", "  in Toolbar", "  in Row"].join("\n"),
    );
  });

  it("omits 'in' lines entirely when no sourceReferences and no componentPath", () => {
    const capture = makeCapture({
      targets: [makeTarget({ metadata: new CaptureMetadata({ identifier: "row-1" }) })],
    });
    expect(formatCaptureForClipboard(capture)).toBe('<BoxRenderable id="row-1">');
  });

  it("falls back to <anonymous> when a source ref has a file but no componentName", () => {
    const capture = makeCapture({
      targets: [
        makeTarget({
          sourceReferences: [new SourceReference({ file: "src/widget.tsx", line: 7 })],
        }),
      ],
    });
    expect(formatCaptureForClipboard(capture)).toBe(
      ["<BoxRenderable>", "  in <anonymous> (at src/widget.tsx:7)"].join("\n"),
    );
  });

  it("renders a componentName-only ref without a location parenthetical", () => {
    const capture = makeCapture({
      targets: [
        makeTarget({
          sourceReferences: [new SourceReference({ componentName: "Toolbar" })],
        }),
      ],
    });
    expect(formatCaptureForClipboard(capture)).toBe(["<BoxRenderable>", "  in Toolbar"].join("\n"));
  });

  it("separates multiple targets with a blank line", () => {
    const capture = makeCapture({
      instruction: "fix both",
      targets: [
        makeTarget({ id: "a", metadata: new CaptureMetadata({ identifier: "row-1" }) }),
        makeTarget({
          id: "b",
          type: "TextRenderable",
          metadata: new CaptureMetadata({ identifier: "row-2" }),
        }),
      ],
    });
    expect(formatCaptureForClipboard(capture)).toBe(
      ["fix both", "", '<BoxRenderable id="row-1">', "", '<TextRenderable id="row-2">'].join("\n"),
    );
  });
});
