import { describe, it, expect } from "vitest";
import { definePersona } from "../src/define-persona";

describe("definePersona", () => {
  it("creates a single resource with contentTemplate", () => {
    const result = definePersona({
      ref: "persona-analyst",
      contentTemplate: "You are {{ state.role }}.",
    });
    expect(result).toBeDefined();
    expect((result as any).scope).toBe("org");
  });

  it("creates a collection with a pattern", () => {
    const result = definePersona({
      pattern: "personas/*",
      contentTemplate: "You are {{ state.role }}.",
    });
    expect(result).toBeDefined();
    expect((result as any).pattern).toBe("personas/*");
  });

  it("defaults scope to org", () => {
    const single = definePersona({
      ref: "p",
      contentTemplate: "t",
    });
    expect((single as any).scope).toBe("org");

    const coll = definePersona({
      pattern: "p/*",
      contentTemplate: "t",
    });
    expect((coll as any).scope).toBe("org");
  });

  it("respects explicit scope", () => {
    const result = definePersona({
      ref: "p",
      scope: "user",
      contentTemplate: "t",
    });
    expect((result as any).scope).toBe("user");
  });
});
