import { describe, expect, it } from "vitest";
import { ANSCRIBE_OVERLAY, isAnscribeOverlay, markAsOverlay } from "@anscribe/core";

describe("capture-overlay marker", () => {
  it("returns false for plain objects", () => {
    expect(isAnscribeOverlay({})).toBe(false);
  });

  it("returns false for null and primitives", () => {
    expect(isAnscribeOverlay(null)).toBe(false);
    expect(isAnscribeOverlay(undefined)).toBe(false);
    expect(isAnscribeOverlay(42)).toBe(false);
    expect(isAnscribeOverlay("string")).toBe(false);
  });

  it("returns true once an object is marked", () => {
    const renderable = markAsOverlay({});
    expect(isAnscribeOverlay(renderable)).toBe(true);
  });

  it("stamps a non-enumerable property so JSON output stays clean", () => {
    const renderable = markAsOverlay({ visible: true });
    expect(Object.keys(renderable)).toEqual(["visible"]);
    expect(JSON.stringify(renderable)).toBe('{"visible":true}');
  });

  it("exposes a stable shared symbol via Symbol.for", () => {
    expect(ANSCRIBE_OVERLAY).toBe(Symbol.for("anscribe.captureOverlay"));
  });
});
