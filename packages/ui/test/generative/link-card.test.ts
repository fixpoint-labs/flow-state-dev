import { describe, expect, it, vi } from "vitest";
import { emitLinkCardTool, LinkCardSchema } from "../../src/generative/link-card";

import { runForTest } from "@flow-state-dev/testing";
function makeCtx() {
  const emitComponent = vi.fn();
  return {
    ctx: { emitComponent } as any,
    emitComponent,
  };
}

describe("emitLinkCardTool", () => {
  it("produces a handler block named 'emitLinkCard' bound to LinkCardSchema", () => {
    const block = emitLinkCardTool();
    expect(block.kind).toBe("handler");
    expect(block.name).toBe("emitLinkCard");
    expect(block.inputSchema).toBe(LinkCardSchema);
    expect(block.description).toMatch(/USE FOR/);
    expect(block.description).toMatch(/DO NOT USE FOR/);
  });

  it("emits a link-card component item keyed by url by default", async () => {
    const block = emitLinkCardTool();
    const { ctx, emitComponent } = makeCtx();

    const input = {
      url: "https://example.com/article",
      title: "Example article",
      description: "A short description.",
      siteName: "Example",
    };

    const output = await runForTest(block, input as any, ctx);

    expect(emitComponent).toHaveBeenCalledWith(
      "link-card",
      input,
      { key: "https://example.com/article" }
    );
    expect(output).toEqual({
      rendered: true,
      kind: "link-card",
      url: "https://example.com/article",
    });
  });

  it("rejects non-URL strings via schema validation", async () => {
    const block = emitLinkCardTool();
    const { ctx } = makeCtx();
    await expect(
      runForTest(block, { url: "not-a-url", title: "x" } as any, ctx)
    ).rejects.toThrow();
  });
});
