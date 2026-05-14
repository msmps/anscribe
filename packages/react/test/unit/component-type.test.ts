import { describe, expect, it } from "vitest";
import { unwrapReactComponentFunction } from "../../src/fiber-pipeline";

// React stamps wrapped components with `Symbol.for("react.<kind>")` on $$typeof.
// We mirror those markers structurally so unwrap is exercised through the same
// branches React's renderer triggers at runtime.
const REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref");
const REACT_MEMO_TYPE = Symbol.for("react.memo");
const REACT_LAZY_TYPE = Symbol.for("react.lazy");

const namedFunction = (name: string): (() => null) => {
  const fn = (): null => null;
  Object.defineProperty(fn, "name", { value: name });
  return fn;
};

describe("unwrapReactComponentFunction", () => {
  it("returns the value unchanged when it is already a function", () => {
    const fn = namedFunction("Plain");
    expect(unwrapReactComponentFunction(fn)).toBe(fn);
  });

  it("returns undefined for null", () => {
    expect(unwrapReactComponentFunction(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(unwrapReactComponentFunction(undefined)).toBeUndefined();
  });

  it("returns undefined for primitives that are not functions", () => {
    expect(unwrapReactComponentFunction("Component")).toBeUndefined();
    expect(unwrapReactComponentFunction(42)).toBeUndefined();
    expect(unwrapReactComponentFunction(true)).toBeUndefined();
    expect(unwrapReactComponentFunction(Symbol("x"))).toBeUndefined();
  });

  it("returns undefined for an object without a known $$typeof", () => {
    expect(unwrapReactComponentFunction({ foo: "bar" })).toBeUndefined();
    expect(
      unwrapReactComponentFunction({ $$typeof: Symbol.for("react.something_else") }),
    ).toBeUndefined();
  });

  it("unwraps a forwardRef by following `.render`", () => {
    const inner = namedFunction("Inner");
    const forwardRef = { $$typeof: REACT_FORWARD_REF_TYPE, render: inner };
    expect(unwrapReactComponentFunction(forwardRef)).toBe(inner);
  });

  it("returns undefined for a forwardRef whose render is not a function or wrapper", () => {
    const broken = { $$typeof: REACT_FORWARD_REF_TYPE, render: "not-a-function" };
    expect(unwrapReactComponentFunction(broken)).toBeUndefined();
  });

  it("unwraps a memo by following `.type`", () => {
    const inner = namedFunction("Inner");
    const memo = { $$typeof: REACT_MEMO_TYPE, type: inner };
    expect(unwrapReactComponentFunction(memo)).toBe(inner);
  });

  it("unwraps nested memo(forwardRef(fn))", () => {
    const inner = namedFunction("Inner");
    const forwardRef = { $$typeof: REACT_FORWARD_REF_TYPE, render: inner };
    const memo = { $$typeof: REACT_MEMO_TYPE, type: forwardRef };
    expect(unwrapReactComponentFunction(memo)).toBe(inner);
  });

  it("unwraps a lazy by calling its _init(_payload)", () => {
    const inner = namedFunction("Inner");
    const lazy = {
      $$typeof: REACT_LAZY_TYPE,
      _payload: { _result: inner },
      _init: (payload: { _result: unknown }) => payload._result,
    };
    expect(unwrapReactComponentFunction(lazy)).toBe(inner);
  });

  it("unwraps a lazy whose _init returns a forwardRef wrapper (multi-step)", () => {
    const inner = namedFunction("Inner");
    const forwardRef = { $$typeof: REACT_FORWARD_REF_TYPE, render: inner };
    const lazy = {
      $$typeof: REACT_LAZY_TYPE,
      _payload: undefined,
      _init: () => forwardRef,
    };
    expect(unwrapReactComponentFunction(lazy)).toBe(inner);
  });

  it("returns undefined when lazy._init is not a function", () => {
    const lazy = { $$typeof: REACT_LAZY_TYPE, _payload: {}, _init: "not-a-function" };
    expect(unwrapReactComponentFunction(lazy)).toBeUndefined();
  });

  it("returns undefined when lazy._init throws", () => {
    const lazy = {
      $$typeof: REACT_LAZY_TYPE,
      _payload: {},
      _init: () => {
        throw new Error("suspense in-flight");
      },
    };
    expect(unwrapReactComponentFunction(lazy)).toBeUndefined();
  });

  it("returns undefined when lazy._init returns a non-component value", () => {
    const lazy = {
      $$typeof: REACT_LAZY_TYPE,
      _payload: {},
      _init: () => "string",
    };
    expect(unwrapReactComponentFunction(lazy)).toBeUndefined();
  });

  it("breaks cycles via the seen-set and returns undefined", () => {
    // memo → forwardRef → memo (cycle): the seen-set should bail out.
    const memoOuter: { $$typeof: symbol; type?: unknown } = { $$typeof: REACT_MEMO_TYPE };
    const forwardRef = { $$typeof: REACT_FORWARD_REF_TYPE, render: memoOuter };
    memoOuter.type = forwardRef;
    expect(unwrapReactComponentFunction(memoOuter)).toBeUndefined();
  });

  it("returns undefined when a wrapper's inner pointer is null", () => {
    const memo = { $$typeof: REACT_MEMO_TYPE, type: null };
    expect(unwrapReactComponentFunction(memo)).toBeUndefined();
  });

  it("returns undefined when a wrapper's inner pointer is undefined", () => {
    const forwardRef = { $$typeof: REACT_FORWARD_REF_TYPE, render: undefined };
    expect(unwrapReactComponentFunction(forwardRef)).toBeUndefined();
  });
});
