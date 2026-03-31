import { describe, expect, it } from "vitest";
import { runUIAdd, toRegistryItemUrl } from "../../src/commands/ui/add";

describe("ui add helpers", () => {
  it("builds canonical registry URL", () => {
    expect(toRegistryItemUrl("message")).toBe("https://ui.flow-state.dev/api/registry/message.json");
  });

  it("handles custom base urls with trailing slash", () => {
    expect(toRegistryItemUrl("all", "https://example.com/r/")).toBe("https://example.com/r/all.json");
  });

  it("rejects empty component name", () => {
    expect(runUIAdd("   ", { dryRun: true })).toBe(2);
  });

  it("supports dry run command assembly", () => {
    expect(runUIAdd("message", { dryRun: true })).toBe(0);
  });
});
