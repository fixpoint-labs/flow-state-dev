/**
 * The second-opinion composition keeps all draft and review messages private
 * and emits its answer only after the blocking analyzer has completed.
 */
import { resolveItemVisibility } from "@flow-state-dev/core/items";
import { describe, expect, it } from "vitest";
import { createSecondOpinionFlow } from "@flow-state-dev/patterns/second-opinion";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";

const flow = createSecondOpinionFlow({
  draftModel: "scripted/draft",
  reviewModel: "scripted/review",
});

describe("second-opinion flow", () => {
  it("drafts, critiques, audits, and only then emits the synthesized answer", async () => {
    const result = await testFlow({
      flow,
      action: "ask",
      userId: "reviewed-user",
      input: { message: "Give me a checked answer" },
      generators: {
        "second-opinion-debater-drafter": mockGenerator({ name: "second-opinion-debater-drafter", script: [{ text: "PRIVATE_DRAFT" }] }),
        "second-opinion-debater-critic": mockGenerator({ name: "second-opinion-debater-critic", script: [{ text: "PRIVATE_CRITIQUE" }] }),
        "second-opinion-judge": mockGenerator({ name: "second-opinion-judge", script: [{ text: JSON.stringify({ verdict: "corrected", winner: null, reasoning: "critique applied" }) }] }),
        "second-opinion-analyzer": mockGenerator({ name: "second-opinion-analyzer", script: [{ text: JSON.stringify({ analyzerId: "independent", category: "correctness", score: 0, shouldSurface: false, annotations: [] }) }] }),
        "second-opinion-synthesizer": mockGenerator({ name: "second-opinion-synthesizer", script: [{ text: "PUBLIC_FINAL" }] }),
      },
      unmockedGeneratorPolicy: "error",
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    const clientItems = result.items.filter(
      (item) => resolveItemVisibility(item).client,
    );
    const visible = JSON.stringify(clientItems);
    expect(visible).toContain("PUBLIC_FINAL");
    expect(visible).not.toContain("PRIVATE_DRAFT");
    expect(visible).not.toContain("PRIVATE_CRITIQUE");
    expect(visible).not.toContain("debate-verdict");
    expect(visible).not.toContain("audit-annotation");

    const criticIndex = result.items.findIndex(
      (item) => item.provenance.blockName === "second-opinion-debater-critic",
    );
    const auditIndex = result.items.findIndex(
      (item) => item.provenance.blockName === "second-opinion-analyzer",
    );
    const finalIndex = result.items.findIndex(
      (item) => item.type === "message" && JSON.stringify(item.content).includes("PUBLIC_FINAL"),
    );
    expect(criticIndex).toBeGreaterThanOrEqual(0);
    expect(auditIndex).toBeGreaterThan(criticIndex);
    expect(finalIndex).toBeGreaterThan(auditIndex);
  });

  it.each(["critic", "judge"])("marks a failed %s as unreviewed and still completes the blocking audit", async (stage) => {
    const result = await testFlow({
      flow,
      action: "ask",
      userId: "rescued-user",
      input: { message: "Give me a checked answer" },
      generators: {
        "second-opinion-debater-drafter": mockGenerator({ name: "second-opinion-debater-drafter", script: [{ text: "draft survives" }] }),
        "second-opinion-debater-critic": mockGenerator({ name: "second-opinion-debater-critic", script: stage === "critic" ? [] : [{ text: "critique" }] }),
        "second-opinion-judge": mockGenerator({ name: "second-opinion-judge", script: stage === "judge" ? [] : [{ text: JSON.stringify({ verdict: "audit it", winner: null, reasoning: "critic unavailable" }) }] }),
        "second-opinion-analyzer": mockGenerator({ name: "second-opinion-analyzer", script: [{ text: JSON.stringify({ analyzerId: "independent", category: "correctness", score: 0, shouldSurface: false, annotations: [] }) }] }),
        "second-opinion-synthesizer": mockGenerator({ name: "second-opinion-synthesizer", script: [{ text: "RESCUED_FINAL" }] }),
      },
      unmockedGeneratorPolicy: "error",
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    expect(JSON.stringify(result.output)).toContain("RESCUED_FINAL");
    expect(result.items).toEqual(expect.arrayContaining([expect.objectContaining({
      type: "data", dataType: "second-opinion-unreviewed",
      value: expect.objectContaining({ stage }),
      itemVisibility: { client: true, history: false },
    })]));
  });
});

// These scenarios exercise the full composition rather than factory shape.
describe("second-opinion audit gate", () => {
  it.each(["finding", "failed", "partial"])("does not synthesize after a %s audit", async (mode) => {
    const { handler } = await import("@flow-state-dev/core");
    const { z } = await import("zod");
    const analyzer = handler({
      name: "audit-check", inputSchema: z.any(),
      execute: () => {
        if (mode !== "finding") throw new Error("audit offline");
        return { analyzerId: "check", category: "correctness", score: 1,
          shouldSurface: true, annotations: [{ type: "error", label: "Incorrect", severity: "critical", description: "PRIVATE_DRAFT is wrong" }] };
      },
    });
    const passing = handler({ name: "passing-check", inputSchema: z.any(),
      execute: () => ({ analyzerId: "pass", category: "correctness", score: 0,
        shouldSurface: false, annotations: [] }) });
    const result = await testFlow({
      flow: createSecondOpinionFlow({ draftModel: "scripted/draft", reviewModel: "scripted/review",
        analyzers: mode === "partial" ? [analyzer, passing] : [analyzer] }),
      action: "ask", userId: "gate-user", input: { message: "Check this" },
      generators: {
        "second-opinion-debater-drafter": mockGenerator({ name: "second-opinion-debater-drafter", script: [{ text: "PRIVATE_DRAFT" }] }),
        "second-opinion-debater-critic": mockGenerator({ name: "second-opinion-debater-critic", script: [{ text: "PRIVATE_CRITIQUE" }] }),
        "second-opinion-judge": mockGenerator({ name: "second-opinion-judge", script: [{ text: JSON.stringify({ verdict: "ok", winner: null, reasoning: "checked" }) }] }),
        "second-opinion-synthesizer": mockGenerator({ name: "second-opinion-synthesizer", script: [{ text: "MUST_NOT_SHIP" }] }),
      },
      unmockedGeneratorPolicy: "error",
    });
    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain(mode === "finding" ? "audit findings" : "audit incomplete");
    const visible = JSON.stringify(result.items.filter(item => resolveItemVisibility(item).client));
    expect(visible).not.toContain("MUST_NOT_SHIP");
    expect(visible).not.toContain("PRIVATE_DRAFT");
  });
});

  it("runs custom judge, analyzer, and synthesizer blocks on a custom flow kind", async () => {
    const { handler } = await import("@flow-state-dev/core");
    const { z } = await import("zod");
    const judge = handler({ name: "custom-judge", inputSchema: z.any(),
      execute: () => ({ verdict: "CUSTOM_VERDICT", winner: null, reasoning: "checked" }) });
    const analyzer = handler({ name: "custom-analyzer", inputSchema: z.any(),
      execute: (input) => {
        expect(input.response).toContain("CUSTOM_VERDICT");
        return { analyzerId: "custom", category: "correctness", score: 0, shouldSurface: false, annotations: [] };
      } });
    const synthesizer = handler({ name: "custom-synthesis", inputSchema: z.any(),
      execute: (input, ctx) => {
        ctx.emit.message(`Reviewed: ${input.verdict.verdict}`);
        return "custom answer";
      } });
    const result = await testFlow({
      flow: createSecondOpinionFlow({ draftModel: "scripted/draft", reviewModel: "scripted/review",
        flowKind: "custom-second-opinion", judge, analyzers: [analyzer], synthesizer }),
      action: "ask", userId: "override-user", input: { message: "Check this" },
      generators: {
        "second-opinion-debater-drafter": mockGenerator({ name: "second-opinion-debater-drafter", script: [{ text: "PRIVATE_DRAFT" }] }),
        "second-opinion-debater-critic": mockGenerator({ name: "second-opinion-debater-critic", script: [{ text: "PRIVATE_CRITIQUE" }] }),
      },
      unmockedGeneratorPolicy: "error",
    });
    expect(result.status).toBe("completed");
    expect(result.output).toBe("custom answer");
    const visible = JSON.stringify(result.items.filter(item => resolveItemVisibility(item).client));
    expect(visible).toContain("Reviewed: CUSTOM_VERDICT");
    expect(visible).not.toContain("PRIVATE_DRAFT");
  });
