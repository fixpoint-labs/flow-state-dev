import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler, utility, router, sequencer } from "../src";
import { createMockContext, runForTest } from "./helpers";
describe("utility.analyzer", () => {
  it("returns a generator block definition", () => {
    const block = utility.analyzer({
      name: "quality-check"
    });

    expect(block.kind).toBe("generator");
    expect(block.name).toBe("quality-check");
  });

  it("supports caller-specified evaluation criteria", async () => {
    const seenMessages: unknown[] = [];
    const block = utility.analyzer({
      name: "criteria-check",
      criteria: ["completeness", "accuracy", "clarity"]
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          seenMessages.push(...options.messages);
          return {
            structuredOutput: {
              findings: [{ criterion: "accuracy", assessment: "solid", severity: "info" }],
              score: 0.9,
              recommendation: "Proceed"
            }
          };
        }
      })
    });

    await expect(runForTest(block, { artifact: "report" }, ctx)).resolves.toEqual({
      findings: [{ criterion: "accuracy", assessment: "solid", severity: "info" }],
      score: 0.9,
      recommendation: "Proceed"
    });

    const serialized = JSON.stringify(seenMessages);
    expect(serialized).toContain("completeness");
    expect(serialized).toContain("accuracy");
    expect(serialized).toContain("clarity");
  });

  it("uses default criteria when none are provided", async () => {
    const seenMessages: unknown[] = [];
    const block = utility.analyzer({ name: "defaults" });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          seenMessages.push(...options.messages);
          return {
            structuredOutput: {
              findings: [{ criterion: "quality", assessment: "good" }]
            }
          };
        }
      })
    });

    await expect(runForTest(block, "artifact", ctx)).resolves.toEqual({
      findings: [{ criterion: "quality", assessment: "good" }]
    });

    const serialized = JSON.stringify(seenMessages);
    expect(serialized).toContain("quality");
    expect(serialized).toContain("risk");
    expect(serialized).toContain("coverage");
    expect(serialized).toContain("confidence");
  });

  it("supports default output schema and caller override", async () => {
    const defaultBlock = utility.analyzer({ name: "default-schema" });
    const customBlock = utility.analyzer({
      name: "custom-schema",
      outputSchema: z.object({
        findings: z.array(z.object({ criterion: z.string(), assessment: z.string() })),
        route: z.enum(["proceed", "review"])
      })
    });

    const defaultCtx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              findings: [
                {
                  criterion: "risk",
                  assessment: "unknown dependencies",
                  severity: "warning",
                  evidence: "lockfile missing"
                }
              ]
            }
          };
        }
      })
    });

    const customCtx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              findings: [{ criterion: "coverage", assessment: "sufficient" }],
              route: "proceed"
            }
          };
        }
      })
    });

    await expect(runForTest(defaultBlock, { text: "artifact" }, defaultCtx)).resolves.toEqual({
      findings: [
        {
          criterion: "risk",
          assessment: "unknown dependencies",
          severity: "warning",
          evidence: "lockfile missing"
        }
      ]
    });

    await expect(runForTest(customBlock, { text: "artifact" }, customCtx)).resolves.toEqual({
      findings: [{ criterion: "coverage", assessment: "sufficient" }],
      route: "proceed"
    });
  });

  it("accepts varied input types", async () => {
    const block = utility.analyzer({ name: "input-shapes" });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              findings: [{ criterion: "clarity", assessment: "clear" }]
            }
          };
        }
      })
    });

    await expect(runForTest(block, "text input", ctx)).resolves.toEqual({
      findings: [{ criterion: "clarity", assessment: "clear" }]
    });

    await expect(runForTest(block, { markdown: "# Heading" }, ctx)).resolves.toEqual({
      findings: [{ criterion: "clarity", assessment: "clear" }]
    });
  });

  it("is composable before router blocks in sequencers", async () => {
    const analyze = utility.analyzer({
      name: "pre-route-analysis",
      criteria: ["risk"]
    });

    const proceedRoute = handler({ name: "proceed-route", execute: () => ({ path: "proceed" }) });
    const reviewRoute = handler({ name: "review-route", execute: () => ({ path: "review" }) });

    const route = router({
      name: "analysis-router",
      routes: [proceedRoute, reviewRoute],
      execute: (input) => {
        const hasCritical = input.findings.some((finding) => finding.severity === "critical");
        return hasCritical ? reviewRoute : proceedRoute;
      }
    });

    const chain = sequencer({
      name: "analysis-chain",
      inputSchema: z.object({ artifact: z.string() })
    })
      .map((input) => input.artifact)
      .step(analyze)
      .step(route);

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              findings: [{ criterion: "risk", assessment: "data loss", severity: "critical" }]
            }
          };
        }
      })
    });

    await expect(runForTest(chain, { artifact: "migration plan" }, ctx)).resolves.toEqual({ path: "review" });
  });
});
