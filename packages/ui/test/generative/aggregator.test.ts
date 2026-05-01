import { describe, expect, it } from "vitest";
import { generativeUI } from "../../src/generative";

describe("generativeUI aggregator", () => {
  it("exposes the starter pack components in canonical order", () => {
    const names = generativeUI.components.map((c) => c.name);
    expect(names).toEqual(["info-card", "link-card"]);
  });

  it(".tools() returns one handler block per component", () => {
    const tools = generativeUI.tools();
    expect(tools).toHaveLength(2);
    expect(tools.every((t) => t.kind === "handler")).toBe(true);
    expect(tools.map((t) => t.name).sort()).toEqual([
      "emitInfoCard",
      "emitLinkCard",
    ]);
  });

  it(".renderers() returns a name → React component map", () => {
    const renderers = generativeUI.renderers();
    expect(Object.keys(renderers).sort()).toEqual(["info-card", "link-card"]);
    expect(typeof renderers["info-card"]).toBe("function");
    expect(typeof renderers["link-card"]).toBe("function");
  });

  it(".pick() returns a scoped subset surface", () => {
    const subset = generativeUI.pick("info-card");
    expect(subset.components.map((c) => c.name)).toEqual(["info-card"]);
    expect(subset.tools()).toHaveLength(1);
    expect(subset.tools()[0]!.name).toBe("emitInfoCard");
    expect(Object.keys(subset.renderers())).toEqual(["info-card"]);
  });

  it(".pick() silently ignores unknown names", () => {
    const subset = generativeUI.pick("info-card", "nonexistent");
    expect(subset.components.map((c) => c.name)).toEqual(["info-card"]);
  });
});
