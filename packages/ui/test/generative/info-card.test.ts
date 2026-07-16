import { describe, expect, it, vi } from "vitest";
import { emitInfoCardTool, InfoCardSchema } from "../../src/generative/tools";
import { runForTest } from "../helpers";
function makeCtx() {
  const emitComponent = vi.fn();
  return {
    ctx: { emit: { component: emitComponent } } as any,
    emitComponent,
  };
}

describe("emitInfoCardTool", () => {
  it("produces a handler block named 'emitInfoCard' bound to InfoCardSchema", () => {
    const block = emitInfoCardTool();
    expect(block.kind).toBe("handler");
    expect(block.name).toBe("emitInfoCard");
    expect(block.inputSchema).toBe(InfoCardSchema);
    expect(typeof block.description).toBe("string");
    expect(block.description).toMatch(/USE FOR/);
    expect(block.description).toMatch(/DO NOT USE FOR/);
  });

  it("emits an info-card component item keyed by id and returns rendered metadata", async () => {
    const block = emitInfoCardTool();
    const { ctx, emitComponent } = makeCtx();

    const input = {
      id: "tokyo-001",
      title: "Asakusa",
      subtitle: "Tokyo's old town",
      facts: [
        { label: "Best for", value: "Senso-ji temple, traditional shops" },
        { label: "Visit", value: "Morning to avoid crowds" },
      ],
    };

    const output = await runForTest(block, input as any, ctx);

    expect(emitComponent).toHaveBeenCalledTimes(1);
    expect(emitComponent).toHaveBeenCalledWith(
      "info-card",
      input,
      { key: "tokyo-001" }
    );
    expect(output).toEqual({ rendered: true, kind: "info-card", id: "tokyo-001" });
  });

  it("honors a custom keyFrom for cross-card identity", async () => {
    const block = emitInfoCardTool({ keyFrom: (i) => `card:${i.title}` });
    const { ctx, emitComponent } = makeCtx();

    await runForTest(block, 
      { id: "x", title: "Shibuya", facts: [] } as any,
      ctx
    );

    expect(emitComponent).toHaveBeenCalledWith(
      "info-card",
      expect.objectContaining({ id: "x", title: "Shibuya" }),
      { key: "card:Shibuya" }
    );
  });

  it("rejects input with more than 8 facts via inputSchema validation", async () => {
    const block = emitInfoCardTool();
    const { ctx } = makeCtx();
    const tooManyFacts = Array.from({ length: 9 }, (_, i) => ({
      label: `l${i}`,
      value: `v${i}`,
    }));

    await expect(
      runForTest(block, 
        { id: "x", title: "T", facts: tooManyFacts } as any,
        ctx
      )
    ).rejects.toThrow();
  });
});
