import { describe, expect, it } from "vitest";
import { z } from "zod";
import { helper, sequencer } from "../src";
import { createMockContext } from "./helpers";

describe("helper.synthesizer", () => {
  it("returns a generator block definition", () => {
    const block = helper.synthesizer({
      name: "synthesize-findings"
    });

    expect(block.kind).toBe("generator");
    expect(block.name).toBe("synthesize-findings");
  });

  it("includes explicit conflict-resolution guidance", async () => {
    const seenMessages: unknown[] = [];
    const block = helper.synthesizer({
      name: "resolve-conflicts",
      objectives: "Prefer sources with direct evidence"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          seenMessages.push(...options.messages);
          return {
            structuredOutput: {
              synthesis: "The rollout should begin with region A while we validate telemetry.",
              rationale: [
                "Source A included production error rates, while source B did not include measurements.",
                "Both sources agreed on phased rollout, so that recommendation was retained."
              ]
            }
          };
        }
      })
    });

    await expect(
      block.run(
        {
          artifacts: [
            "Source A: Start in region A because error rates are below threshold.",
            "Source B: Start in region C for marketing reasons."
          ]
        },
        ctx
      )
    ).resolves.toEqual({
      synthesis: "The rollout should begin with region A while we validate telemetry.",
      rationale: [
        "Source A included production error rates, while source B did not include measurements.",
        "Both sources agreed on phased rollout, so that recommendation was retained."
      ]
    });

    const serialized = JSON.stringify(seenMessages);
    expect(serialized).toContain("resolve the disagreement");
    expect(serialized).toContain("Prefer sources with direct evidence");
  });

  it("synthesizes complementary inputs into a unified output", async () => {
    const block = helper.synthesizer({
      name: "merge-complementary"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              synthesis: "Ship a beta with audit logs, onboarding docs, and escalation playbooks.",
              rationale: [
                "Each input contributed a non-overlapping requirement.",
                "Redundant phrasing was consolidated into a single action plan."
              ]
            }
          };
        }
      })
    });

    await expect(
      block.run(
        [
          "Security review requires audit logging.",
          "Support team needs an escalation playbook.",
          "Product asks for onboarding docs."
        ],
        ctx
      )
    ).resolves.toEqual({
      synthesis: "Ship a beta with audit logs, onboarding docs, and escalation playbooks.",
      rationale: [
        "Each input contributed a non-overlapping requirement.",
        "Redundant phrasing was consolidated into a single action plan."
      ]
    });
  });

  it("uses default output schema and supports override", async () => {
    const defaultBlock = helper.synthesizer({ name: "default-schema" });
    const customBlock = helper.synthesizer({
      name: "custom-schema",
      outputSchema: z.object({
        synthesis: z.string(),
        confidence: z.number()
      })
    });

    const defaultCtx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              synthesis: "Canonical recommendation",
              rationale: ["Conflicting priorities were reconciled by impact score."]
            }
          };
        }
      })
    });

    const customCtx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return { structuredOutput: { synthesis: "Canonical recommendation", confidence: 0.83 } };
        }
      })
    });

    await expect(defaultBlock.run("x", defaultCtx)).resolves.toEqual({
      synthesis: "Canonical recommendation",
      rationale: ["Conflicting priorities were reconciled by impact score."]
    });
    await expect(customBlock.run("x", customCtx)).resolves.toEqual({
      synthesis: "Canonical recommendation",
      confidence: 0.83
    });
  });

  it("is composable inside sequencers", async () => {
    const synthesize = helper.synthesizer({
      name: "synthesize-in-sequencer"
    });

    const chain = sequencer({
      name: "synthesis-chain",
      inputSchema: z.object({ artifacts: z.array(z.string()) })
    })
      .map((input) => input.artifacts)
      .then(synthesize);

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              synthesis: "Unified synthesis",
              rationale: ["Conflicts were settled by recency and evidence quality."]
            }
          };
        }
      })
    });

    await expect(
      chain.run(
        {
          artifacts: ["One source", "Another source"]
        },
        ctx
      )
    ).resolves.toEqual({
      synthesis: "Unified synthesis",
      rationale: ["Conflicts were settled by recency and evidence quality."]
    });
  });
});
