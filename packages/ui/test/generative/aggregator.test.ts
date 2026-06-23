import { describe, expect, it } from "vitest";
import { generativeTools } from "../../src/generative/tools";
import { generativeRenderers } from "../../src/generative/renderers";

describe("generative tools surface", () => {
  it("generativeTools() returns one handler block per component", () => {
    const tools = generativeTools();
    expect(tools).toHaveLength(2);
    expect(tools.every((t) => t.kind === "handler")).toBe(true);
    expect(tools.map((t) => t.name).sort()).toEqual([
      "emitInfoCard",
      "emitLinkCard",
    ]);
  });

  it("generativeTools.pick() returns a scoped subset", () => {
    const tools = generativeTools.pick("info-card");
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("emitInfoCard");
  });

  it("generativeTools.pick() silently ignores unknown names", () => {
    const tools = generativeTools.pick("info-card", "nonexistent");
    expect(tools.map((t) => t.name)).toEqual(["emitInfoCard"]);
  });
});

describe("generative renderers surface", () => {
  it("generativeRenderers() returns a name → React component map", () => {
    const renderers = generativeRenderers();
    expect(Object.keys(renderers).sort()).toEqual(["info-card", "link-card"]);
    expect(typeof renderers["info-card"]).toBe("function");
    expect(typeof renderers["link-card"]).toBe("function");
  });

  it("generativeRenderers.pick() returns a scoped subset", () => {
    const renderers = generativeRenderers.pick("link-card");
    expect(Object.keys(renderers)).toEqual(["link-card"]);
  });

  it("generativeRenderers.pick() silently ignores unknown names", () => {
    const renderers = generativeRenderers.pick("info-card", "nonexistent");
    expect(Object.keys(renderers)).toEqual(["info-card"]);
  });
});
