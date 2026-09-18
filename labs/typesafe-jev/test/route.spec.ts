/**
 * Confidence-gated intent routing — the reason this block exists.
 */
import { describe, expect, it } from "vitest";
import { routeByChoice } from "../src/route";

const peakedBilling = {
  type: "choice" as const,
  choice: "billing",
  probabilities: { billing: 0.87, technical: 0.13, sales: 0 },
  confidence: 0.8,
};

describe("routeByChoice", () => {
  it("returns the choice when confidence clears the floor", () => {
    expect(routeByChoice({ choice: peakedBilling })).toEqual({
      destination: "billing",
      reason: 'choice "billing" at confidence 0.8',
    });
  });

  it("escalates when the distribution is flat", () => {
    const decision = routeByChoice({
      choice: {
        type: "choice",
        choice: "technical",
        probabilities: { billing: 0.34, technical: 0.36, sales: 0.3 },
        confidence: 0.12,
      },
    });
    expect(decision.destination).toBe("escalate");
    expect(decision.reason).toContain("0.12");
  });

  it("escalates a high-stakes combo even when the choice is peaked", () => {
    const decision = routeByChoice({
      choice: peakedBilling,
      escalateIf: {
        noul: { type: "noul", noul: 0.95 },
        whenAbove: 0.8,
        andChoice: "billing",
      },
    });
    expect(decision.destination).toBe("escalate");
    expect(decision.reason).toContain("0.95");
  });

  it("does not apply the noul gate to a different choice", () => {
    const decision = routeByChoice({
      choice: { ...peakedBilling, choice: "technical" },
      escalateIf: {
        noul: { type: "noul", noul: 0.95 },
        whenAbove: 0.8,
        andChoice: "billing",
      },
    });
    expect(decision.destination).toBe("technical");
  });
});
