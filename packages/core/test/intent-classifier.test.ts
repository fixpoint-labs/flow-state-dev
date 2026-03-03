import { describe, expect, it } from "vitest";
import { z } from "zod";
import { helper, sequencer } from "../src";
import { createMockContext } from "./helpers";

describe("helper.intentClassifier", () => {
  const categories = {
    billing: "Questions related to invoices, charges, or subscription payments.",
    "technical-support": "Requests about bugs, outages, or product behavior that is not working.",
    "general-inquiry": "General product questions and feature clarifications."
  } as const;

  it("returns a generator block definition", () => {
    const block = helper.intentClassifier({
      name: "support-intent",
      categories
    });

    expect(block.kind).toBe("generator");
    expect(block.name).toBe("support-intent");
  });

  it("requires at least 2 categories", () => {
    expect(() =>
      helper.intentClassifier({
        name: "invalid",
        categories: { only: "single option" }
      })
    ).toThrow(/at least 2 categories/);
  });

  it("injects category descriptions into the prompt", async () => {
    const seenMessages: unknown[] = [];
    const block = helper.intentClassifier({
      name: "descriptions",
      categories
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          seenMessages.push(...options.messages);
          return { structuredOutput: { category: "billing", confidence: 0.92 } };
        }
      })
    });

    await expect(block.run("I was charged twice", ctx)).resolves.toEqual({
      category: "billing",
      confidence: 0.92
    });

    const serialized = JSON.stringify(seenMessages);
    expect(serialized).toContain("billing");
    expect(serialized).toContain("invoices");
    expect(serialized).toContain("technical-support");
    expect(serialized).toContain("bugs");
  });

  it("validates output category against declared category keys", async () => {
    const block = helper.intentClassifier({
      name: "validate-category",
      categories
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return { structuredOutput: { category: "sales", confidence: 0.4 } };
        }
      })
    });

    await expect(block.run("Do you have enterprise pricing?", ctx)).rejects.toThrow(/Category must be one of/);
  });

  it("uses default output schema and supports override", async () => {
    const defaultBlock = helper.intentClassifier({
      name: "default-schema",
      categories
    });

    const customBlock = helper.intentClassifier({
      name: "custom-schema",
      categories,
      outputSchema: z.object({
        category: z.string(),
        confidence: z.number(),
        labelReason: z.string()
      })
    });

    const defaultCtx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return { structuredOutput: { category: "technical-support", confidence: 0.71, reasoning: "Error report" } };
        }
      })
    });

    const customCtx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return { structuredOutput: { category: "general-inquiry", confidence: 0.88, labelReason: "Feature question" } };
        }
      })
    });

    await expect(defaultBlock.run("The app crashes", defaultCtx)).resolves.toEqual({
      category: "technical-support",
      confidence: 0.71,
      reasoning: "Error report"
    });

    await expect(customBlock.run("How does this work?", customCtx)).resolves.toEqual({
      category: "general-inquiry",
      confidence: 0.88,
      labelReason: "Feature question"
    });
  });

  it("is composable inside sequencers", async () => {
    const classify = helper.intentClassifier({
      name: "classify-in-sequencer",
      categories
    });

    const chain = sequencer({
      name: "intent-chain",
      inputSchema: z.object({ message: z.string() })
    })
      .map((input) => input.message)
      .then(classify);

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return { structuredOutput: { category: "billing", confidence: 0.9 } };
        }
      })
    });

    await expect(chain.run({ message: "Invoice question" }, ctx)).resolves.toEqual({
      category: "billing",
      confidence: 0.9
    });
  });

  it("handles different category sets with description specificity", async () => {
    const seenMessages: unknown[] = [];
    const triage = helper.intentClassifier({
      name: "triage",
      categories: {
        urgent: "Immediate risk, outage, or customer-impacting incident.",
        normal: "Routine request that can be handled in normal SLA windows.",
        low: "Informational request without urgency."
      }
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          seenMessages.push(...options.messages);
          return { structuredOutput: { category: "urgent", confidence: 0.95, reasoning: "Production outage" } };
        }
      })
    });

    await expect(triage.run("The checkout flow is down", ctx)).resolves.toEqual({
      category: "urgent",
      confidence: 0.95,
      reasoning: "Production outage"
    });

    expect(JSON.stringify(seenMessages)).toContain("customer-impacting incident");
  });
});
