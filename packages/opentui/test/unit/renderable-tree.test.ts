import { describe, expect, it } from "vitest";
import {
  asRenderableRecord,
  isRenderableVisible,
  readFiniteNumber,
  readRenderableType,
  walkRenderableTree,
} from "../../src/renderable-tree";

// renderable-tree.ts walks OpenTUI's class-based renderable graph defensively.
// Tests pass POJOs that mimic just the surface the module reads.

interface FakeRenderable {
  readonly typeName?: string;
  readonly visible?: boolean;
  readonly children?: ReadonlyArray<unknown>;
  readonly extras?: Record<string, unknown>;
}

const renderable = (overrides: FakeRenderable = {}): Record<string, unknown> => {
  const typeName = overrides.typeName ?? "BoxRenderable";
  const node: Record<string, unknown> = {
    constructor: { name: typeName },
    visible: overrides.visible ?? true,
    getChildren: () => overrides.children ?? [],
    ...overrides.extras,
  };

  return node;
};

describe("asRenderableRecord", () => {
  it("returns the value when given a plain object", () => {
    const value = { foo: "bar" };
    expect(asRenderableRecord(value)).toBe(value);
  });

  it("returns undefined for null", () => {
    expect(asRenderableRecord(null)).toBeUndefined();
  });

  it("returns undefined for primitives", () => {
    expect(asRenderableRecord("string")).toBeUndefined();
    expect(asRenderableRecord(42)).toBeUndefined();
    expect(asRenderableRecord(true)).toBeUndefined();
    expect(asRenderableRecord(undefined)).toBeUndefined();
  });

  it("returns arrays unchanged (typeof array === 'object')", () => {
    // Pinned quirk: arrays survive the gate because typeof array === "object".
    // Callers downstream are expected to look at object shape, not just truthiness.
    const arr = [1, 2, 3];
    expect(asRenderableRecord(arr)).toBe(arr);
  });
});

describe("isRenderableVisible", () => {
  it("defaults to visible when the property is missing", () => {
    expect(isRenderableVisible({})).toBe(true);
  });

  it("defaults to visible when visible is explicitly true", () => {
    expect(isRenderableVisible({ visible: true })).toBe(true);
  });

  it("treats any non-false value as visible (e.g. undefined, null, truthy)", () => {
    expect(isRenderableVisible({ visible: undefined })).toBe(true);
    expect(isRenderableVisible({ visible: null })).toBe(true);
    expect(isRenderableVisible({ visible: 0 })).toBe(true);
    expect(isRenderableVisible({ visible: "" })).toBe(true);
  });

  it("returns false only when visible === false strictly", () => {
    expect(isRenderableVisible({ visible: false })).toBe(false);
  });
});

describe("readRenderableType", () => {
  it("returns the constructor function's name", () => {
    expect(readRenderableType({ constructor: { name: "BoxRenderable" } })).toBe("BoxRenderable");
  });

  it("reads name from a constructor object whose value is not a function", () => {
    expect(readRenderableType({ constructor: { name: "InputRenderable" } })).toBe(
      "InputRenderable",
    );
  });

  it("falls back to 'Renderable' when the constructor has an empty name string", () => {
    expect(readRenderableType({ constructor: { name: "" } })).toBe("Renderable");
  });

  it("falls back to 'Renderable' for prototype-less records (no constructor at all)", () => {
    const naked = Object.create(null) as Record<string, unknown>;
    expect(readRenderableType(naked)).toBe("Renderable");
  });

  it("returns 'Object' for plain object literals (their constructor is the Object function)", () => {
    // Pinned quirk: plain `{}` has `constructor === Object`, so the type
    // resolves to "Object" rather than the fallback. Real renderables in
    // OpenTUI are class instances so this branch is benign in practice.
    expect(readRenderableType({})).toBe("Object");
  });

  it("falls back to 'Renderable' when constructor is a non-object primitive", () => {
    expect(readRenderableType({ constructor: 42 })).toBe("Renderable");
    expect(readRenderableType({ constructor: null })).toBe("Renderable");
    expect(readRenderableType({ constructor: "BoxRenderable" })).toBe("Renderable");
  });

  it("returns the function-constructor's .name when constructor is a function", () => {
    function BoxRenderable() {}
    expect(readRenderableType({ constructor: BoxRenderable })).toBe("BoxRenderable");
  });

  it("falls back to 'Renderable' when a function-constructor has an empty name", () => {
    const anon = (() => () => {})();
    Object.defineProperty(anon, "name", { value: "" });
    expect(readRenderableType({ constructor: anon })).toBe("Renderable");
  });
});

describe("readFiniteNumber", () => {
  it("returns finite numbers unchanged", () => {
    expect(readFiniteNumber(0)).toBe(0);
    expect(readFiniteNumber(42)).toBe(42);
    expect(readFiniteNumber(-3.5)).toBe(-3.5);
  });

  it("returns 0 for Infinity, -Infinity, and NaN", () => {
    expect(readFiniteNumber(Number.POSITIVE_INFINITY)).toBe(0);
    expect(readFiniteNumber(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(readFiniteNumber(Number.NaN)).toBe(0);
  });

  it("returns 0 for non-number values", () => {
    expect(readFiniteNumber("42")).toBe(0);
    expect(readFiniteNumber(undefined)).toBe(0);
    expect(readFiniteNumber(null)).toBe(0);
    expect(readFiniteNumber(true)).toBe(0);
    expect(readFiniteNumber({})).toBe(0);
  });
});

describe("walkRenderableTree", () => {
  it("visits the root exactly once when it has no children", () => {
    const root = renderable();
    const visits: Array<readonly string[]> = [];

    walkRenderableTree(root, (_node, ancestry) => {
      visits.push(ancestry);
    });

    expect(visits).toEqual([["BoxRenderable"]]);
  });

  it("yields one ancestry entry per visited node, accumulating parent types", () => {
    const tree = renderable({
      typeName: "Root",
      children: [
        renderable({
          typeName: "Middle",
          children: [renderable({ typeName: "Leaf" })],
        }),
      ],
    });
    const visits: Array<readonly string[]> = [];

    walkRenderableTree(tree, (_node, ancestry) => {
      visits.push(ancestry);
    });

    expect(visits).toEqual([["Root"], ["Root", "Middle"], ["Root", "Middle", "Leaf"]]);
  });

  it("does nothing when the root is not an object", () => {
    const visits: unknown[] = [];

    walkRenderableTree(null, (node) => visits.push(node));
    walkRenderableTree(undefined, (node) => visits.push(node));
    walkRenderableTree("not-a-node", (node) => visits.push(node));
    walkRenderableTree(42, (node) => visits.push(node));

    expect(visits).toEqual([]);
  });

  it("skips children that are not objects (filtered by asRenderableRecord)", () => {
    const tree = renderable({
      typeName: "Root",
      children: ["string-child", 42, null, renderable({ typeName: "RealChild" })],
    });
    const visits: Array<readonly string[]> = [];

    walkRenderableTree(tree, (_node, ancestry) => {
      visits.push(ancestry);
    });

    expect(visits).toEqual([["Root"], ["Root", "RealChild"]]);
  });

  it("treats a missing getChildren as no children", () => {
    const tree: Record<string, unknown> = { constructor: { name: "Root" } };
    const visits: unknown[] = [];

    walkRenderableTree(tree, (_node, ancestry) => {
      visits.push(ancestry);
    });

    expect(visits).toEqual([["Root"]]);
  });

  it("treats a non-function getChildren as no children", () => {
    const tree: Record<string, unknown> = {
      constructor: { name: "Root" },
      getChildren: "not a function",
    };
    const visits: unknown[] = [];

    walkRenderableTree(tree, (_node, ancestry) => {
      visits.push(ancestry);
    });

    expect(visits).toEqual([["Root"]]);
  });

  it("treats getChildren returning a non-array as no children", () => {
    const tree: Record<string, unknown> = {
      constructor: { name: "Root" },
      getChildren: () => ({ not: "an array" }),
    };
    const visits: unknown[] = [];

    walkRenderableTree(tree, (_node, ancestry) => {
      visits.push(ancestry);
    });

    expect(visits).toEqual([["Root"]]);
  });

  it("passes the original record (not a copy) to the visitor", () => {
    const root = renderable({ extras: { marker: "sentinel" } });
    let captured: unknown;

    walkRenderableTree(root, (node) => {
      captured = node;
    });

    expect(captured).toBe(root);
  });

  it("visits parents before children (pre-order)", () => {
    const tree = renderable({
      typeName: "Root",
      children: [
        renderable({ typeName: "ChildA" }),
        renderable({
          typeName: "ChildB",
          children: [renderable({ typeName: "GrandchildB1" })],
        }),
      ],
    });
    const visits: string[] = [];

    walkRenderableTree(tree, (_node, ancestry) => {
      const last = ancestry.at(-1);
      if (last !== undefined) visits.push(last);
    });

    expect(visits).toEqual(["Root", "ChildA", "ChildB", "GrandchildB1"]);
  });
});
