/**
 * The second-opinion composition keeps all draft and review messages private
 * and emits its answer only after the blocking analyzer has completed.
 */
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
        "second-opinion-analyzer": mockGenerator({ name: "second-opinion-analyzer", script: [{ text: JSON.stringify({ analyzerId: "independent", category: "correctness", score: 1, shouldSurface: true, annotations: [] }) }] }),
        "second-opinion-synthesizer": mockGenerator({ name: "second-opinion-synthesizer", script: [{ text: "PUBLIC_FINAL" }] }),
      },
      unmockedGeneratorPolicy: "error",
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    const clientItems = result.items.filter(
      (item) => item.itemVisibility?.client !== false,
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

  it("rescues a failed critic at that step and still completes the blocking audit", async () => {
    const result = await testFlow({
      flow,
      action: "ask",
      userId: "rescued-user",
      input: { message: "Give me a checked answer" },
      generators: {
        "second-opinion-debater-drafter": mockGenerator({ name: "second-opinion-debater-drafter", script: [{ text: "draft survives" }] }),
        "second-opinion-debater-critic": mockGenerator({ name: "second-opinion-debater-critic", script: [] }),
        "second-opinion-judge": mockGenerator({ name: "second-opinion-judge", script: [{ text: JSON.stringify({ verdict: "audit it", winner: null, reasoning: "critic unavailable" }) }] }),
        "second-opinion-analyzer": mockGenerator({ name: "second-opinion-analyzer", script: [{ text: JSON.stringify({ analyzerId: "independent", category: "correctness", score: 1, shouldSurface: true, annotations: [] }) }] }),
        "second-opinion-synthesizer": mockGenerator({ name: "second-opinion-synthesizer", script: [{ text: "RESCUED_FINAL" }] }),
      },
      unmockedGeneratorPolicy: "error",
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    expect(JSON.stringify(result.output)).toContain("RESCUED_FINAL");
  });
});
