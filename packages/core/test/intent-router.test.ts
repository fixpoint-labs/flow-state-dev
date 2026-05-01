import { describe, expect, it } from "vitest";
import { handler, sequencer, utility } from "../src";
import { createMockContext } from "./helpers";

describe("utility.intentRouter", () => {
  const makeContext = (category: string, confidence: number) =>
    createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              category,
              confidence
            }
          };
        }
      })
    });

  it("returns a sequencer block definition", () => {
    const billing = handler({
      name: "billing-handler",
      execute: (input) => input
    });

    const tech = handler({
      name: "tech-handler",
      execute: (input) => input
    });

    const block = utility.intentRouter({
      name: "support-triage",
      categories: {
        billing: {
          description: "Billing issues",
          handler: billing
        },
        technical: {
          description: "Technical issues",
          handler: tech
        }
      }
    });

    expect(block.kind).toBe("sequencer");
    expect(block.name).toBe("support-triage");
  });

  it("routes to the exact matched category handler", async () => {
    const billing = handler({
      name: "billing-handler",
      execute: () => ({ route: "billing" as const })
    });

    const tech = handler({
      name: "tech-handler",
      execute: () => ({ route: "technical" as const })
    });

    const triage = utility.intentRouter({
      name: "exact-match",
      categories: {
        billing: {
          description: "Billing issues",
          handler: billing
        },
        technical: {
          description: "Technical issues",
          handler: tech
        }
      }
    });

    await expect(triage.run("I was charged twice", makeContext("billing", 0.91))).resolves.toEqual({
      route: "billing"
    });
  });

  it("routes low-confidence classifications to fallback when threshold is set", async () => {
    const billing = handler({
      name: "billing-handler-threshold",
      execute: () => ({ route: "billing" as const })
    });

    const technical = handler({
      name: "tech-handler-threshold",
      execute: () => ({ route: "technical" as const })
    });

    const fallback = handler({
      name: "fallback-handler",
      execute: () => ({ route: "fallback" as const })
    });

    const triage = utility.intentRouter({
      name: "threshold-fallback",
      categories: {
        billing: {
          description: "Billing issues",
          handler: billing
        },
        technical: {
          description: "Technical issues",
          handler: technical
        }
      },
      confidenceThreshold: 0.7,
      fallback
    });

    await expect(triage.run("help", makeContext("billing", 0.4))).resolves.toEqual({
      route: "fallback"
    });
  });

  it("throws a descriptive error when confidence is below threshold without fallback", async () => {
    const billing = handler({
      name: "billing-handler-no-fallback",
      execute: () => ({ route: "billing" as const })
    });

    const technical = handler({
      name: "tech-handler-no-fallback",
      execute: () => ({ route: "technical" as const })
    });

    const triage = utility.intentRouter({
      name: "threshold-no-fallback",
      categories: {
        billing: {
          description: "Billing issues",
          handler: billing
        },
        technical: {
          description: "Technical issues",
          handler: technical
        }
      },
      confidenceThreshold: 0.8
    });

    await expect(triage.run("help", makeContext("billing", 0.5))).rejects.toThrow(
      /below threshold 0.8, and no fallback handler was provided/
    );
  });

  it("forwards the original input to the matched category handler", async () => {
    const billing = handler({
      name: "billing-handler-input",
      execute: (input: unknown) => ({ received: input })
    });

    const tech = handler({
      name: "tech-handler-input",
      execute: (input: unknown) => ({ received: input })
    });

    const triage = utility.intentRouter({
      name: "input-forwarding",
      categories: {
        billing: { description: "Billing issues", handler: billing },
        technical: { description: "Technical issues", handler: tech }
      }
    });

    await expect(
      triage.run("I was charged twice", makeContext("billing", 0.91))
    ).resolves.toEqual({ received: "I was charged twice" });
  });

  it("supports nested sequencer category handlers", async () => {
    const nested = sequencer({ name: "nested-technical" })
      .map(() => "nested")
      .then(
        handler({
          name: "nested-final",
          execute: (input) => ({ route: input })
        })
      );

    const billing = handler({
      name: "billing-handler-nested",
      execute: () => ({ route: "billing" as const })
    });

    const triage = utility.intentRouter({
      name: "nested-route",
      categories: {
        billing: {
          description: "Billing issues",
          handler: billing
        },
        technical: {
          description: "Technical issues",
          handler: nested
        }
      }
    });

    await expect(triage.run("app is crashing", makeContext("technical", 0.88))).resolves.toEqual({
      route: "nested"
    });
  });
});
