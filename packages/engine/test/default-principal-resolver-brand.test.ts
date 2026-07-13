import { describe, expect, it } from "vitest";
import {
  defaultBodyUserIdPrincipalResolver,
  isDefaultBodyUserIdPrincipalResolver,
} from "../src/transports/auth/defaultBodyUserIdPrincipalResolver";

describe("isDefaultBodyUserIdPrincipalResolver", () => {
  it("recognizes the framework default resolver", () => {
    expect(isDefaultBodyUserIdPrincipalResolver(defaultBodyUserIdPrincipalResolver)).toBe(true);
  });

  it("recognizes a default resolver from a different module instance via the global-symbol brand", () => {
    // Simulate a duplicate @flow-state-dev/engine copy: a separate function value
    // that carries the same globally-registered brand.
    const brand = Symbol.for("@flow-state-dev/engine/defaultBodyUserIdPrincipalResolver");
    const fromOtherInstance = (() => null) as unknown as Record<symbol, boolean>;
    fromOtherInstance[brand] = true;
    expect(isDefaultBodyUserIdPrincipalResolver(fromOtherInstance)).toBe(true);
  });

  it("does not recognize a custom resolver, even one wrapping the default", () => {
    const custom = () => ({ userId: "owner" });
    const wrapper = (ctx: Parameters<typeof defaultBodyUserIdPrincipalResolver>[0]) =>
      defaultBodyUserIdPrincipalResolver(ctx);
    expect(isDefaultBodyUserIdPrincipalResolver(custom)).toBe(false);
    expect(isDefaultBodyUserIdPrincipalResolver(wrapper)).toBe(false);
  });

  it("returns false for non-function values", () => {
    for (const value of [undefined, null, {}, "resolver", 42]) {
      expect(isDefaultBodyUserIdPrincipalResolver(value)).toBe(false);
    }
  });
});
