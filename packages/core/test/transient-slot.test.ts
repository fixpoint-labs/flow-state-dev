import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  transientSlot,
  isTransientSlot,
  getTransientKeys,
  stripTransientKeys,
} from "../src/utils/transient-slot";

describe("transientSlot", () => {
  it("stamps the marker so isTransientSlot returns true", () => {
    expect(isTransientSlot(transientSlot(z.string()))).toBe(true);
  });

  it("isTransientSlot is false on unmarked schemas", () => {
    expect(isTransientSlot(z.string())).toBe(false);
  });

  it("isTransientSlot tolerates undefined", () => {
    expect(isTransientSlot(undefined)).toBe(false);
  });

  it("getTransientKeys returns the marked keys from a z.object shape", () => {
    const schema = z.object({
      a: transientSlot(z.string()),
      b: z.number(),
      c: transientSlot(z.boolean().default(false)),
    });
    const keys = getTransientKeys(schema);
    expect(keys.has("a")).toBe(true);
    expect(keys.has("b")).toBe(false);
    expect(keys.has("c")).toBe(true);
    expect(keys.size).toBe(2);
  });

  it("preserves an inner .describe() — marker doesn't override description", () => {
    const inner = z.string().describe("user-readable doc");
    const marked = transientSlot(inner);
    expect((marked as unknown as { _def: { description?: string } })._def.description).toBe(
      "user-readable doc"
    );
    expect(isTransientSlot(marked)).toBe(true);
  });

  it("marker survives wrapping when transientSlot is applied last", () => {
    // Recommended chaining order: transientSlot(z.boolean().default(false))
    const schema = z.object({
      flag: transientSlot(z.boolean().default(false)),
    });
    expect(getTransientKeys(schema).has("flag")).toBe(true);
  });

  it("getTransientKeys on undefined returns an empty set", () => {
    expect(getTransientKeys(undefined).size).toBe(0);
  });

  it("getTransientKeys on a non-object schema returns an empty set", () => {
    expect(getTransientKeys(z.string()).size).toBe(0);
  });

  it("stripTransientKeys returns a new object without the listed keys", () => {
    const before = { visible: 1, scratch: "x" };
    const after = stripTransientKeys(before, new Set(["scratch"]));
    expect(after).toEqual({ visible: 1 });
    expect(before).toEqual({ visible: 1, scratch: "x" });
  });

  it("stripTransientKeys returns the original when no keys are transient", () => {
    const before = { visible: 1 };
    const after = stripTransientKeys(before, new Set());
    expect(after).toBe(before);
  });
});
