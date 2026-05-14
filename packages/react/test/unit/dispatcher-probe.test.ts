import { describe, expect, it } from "vitest";
import {
  probeComponentSource,
  setReactCurrentDispatcherRef,
  type ReactComponentFunction,
} from "../../src/fiber-pipeline";

const asReactComponent = (fn: () => unknown): ReactComponentFunction =>
  fn as unknown as ReactComponentFunction;

// `currentDispatcherRef` is module-scope state. Vitest runs declared tests in
// file order, so the "unset ref" assertion must come first — once setReactCurrentDispatcherRef
// has been called with a real object, there is no way to clear it back to
// undefined (the setter only writes when `isObject(ref)` holds).

describe("probeComponentSource — module-scope unset state (must run first)", () => {
  it("returns undefined when currentDispatcherRef has not been set", () => {
    function NotProbed(): null {
      return null;
    }
    expect(probeComponentSource(asReactComponent(NotProbed))).toBeUndefined();
  });

  it("ignores non-object inputs to setReactCurrentDispatcherRef", () => {
    setReactCurrentDispatcherRef(null);
    setReactCurrentDispatcherRef(undefined);
    setReactCurrentDispatcherRef(42);
    setReactCurrentDispatcherRef("nope");
    function StillNotProbed(): null {
      return null;
    }
    expect(probeComponentSource(asReactComponent(StillNotProbed))).toBeUndefined();
  });
});

describe("probeComponentSource — class components", () => {
  it("returns undefined for class components", () => {
    // Set the ref so we exercise the class-component guard rather than the unset path.
    setReactCurrentDispatcherRef({ H: null });

    class ClassComp {
      static readonly isReactComponent = {};
    }
    // Mirror what React stamps: `prototype.isReactComponent`. ReactComponentFunction
    // doesn't model class components, so we cast through unknown.
    (ClassComp.prototype as { isReactComponent?: unknown }).isReactComponent = {};

    expect(probeComponentSource(ClassComp as unknown as ReactComponentFunction)).toBeUndefined();
  });
});

describe("probeComponentSource — modern H dispatcher slot", () => {
  it("returns a SourceReference parsed from the dispatcher-proxy abort stack", () => {
    const dispatcherRef: { H: unknown } = { H: null };
    setReactCurrentDispatcherRef(dispatcherRef);

    // Mimic React's `useState` codepath: real React reads `ReactSharedInternals.H`
    // and invokes a property on it. The probe replaces H with a proxy whose `get`
    // trap throws — so any property access aborts the call with a stack we can parse.
    function MyComponent(): void {
      (dispatcherRef.H as { useState: () => void }).useState();
    }

    const ref = probeComponentSource(asReactComponent(MyComponent));
    expect(ref).toBeDefined();
    expect(ref?.origin).toBe("dispatcher-probe");
    expect(ref?.file).toContain("dispatcher-probe.test");
    expect(ref?.functionName).toBe("MyComponent");
    expect(typeof ref?.line).toBe("number");
  });

  it("restores the original dispatcher slot value after probing", () => {
    const sentinel = { useState: () => undefined };
    const dispatcherRef: { H: unknown } = { H: sentinel };
    setReactCurrentDispatcherRef(dispatcherRef);

    function Probed(): void {
      (dispatcherRef.H as { useState: () => void }).useState();
    }
    probeComponentSource(asReactComponent(Probed));

    expect(dispatcherRef.H).toBe(sentinel);
  });
});

describe("probeComponentSource — legacy ReactCurrentDispatcher.current slot", () => {
  it("returns a SourceReference when only the legacy slot is available", () => {
    const legacy = { current: null as unknown };
    const dispatcherRef = { ReactCurrentDispatcher: legacy };
    setReactCurrentDispatcherRef(dispatcherRef);

    function LegacyComp(): void {
      (legacy.current as { useState: () => void }).useState();
    }

    const ref = probeComponentSource(asReactComponent(LegacyComp));
    expect(ref).toBeDefined();
    expect(ref?.origin).toBe("dispatcher-probe");
    expect(ref?.functionName).toBe("LegacyComp");
  });

  it("returns undefined when neither H nor legacy slot is present", () => {
    setReactCurrentDispatcherRef({ unrelated: true });

    function NoSlot(): void {}
    expect(probeComponentSource(asReactComponent(NoSlot))).toBeUndefined();
  });
});

describe("probeComponentSource — frame selection", () => {
  it("returns undefined when the component never touches the dispatcher", () => {
    setReactCurrentDispatcherRef({ H: null });
    function HookFreeComp(): null {
      return null;
    }
    expect(probeComponentSource(asReactComponent(HookFreeComp))).toBeUndefined();
  });
});
