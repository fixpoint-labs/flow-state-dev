import { describe, expect, it } from "vitest";
import { analyzerScorer } from "../src/eval/analyzerScorer";
import { createMockModelResolver, mockGenerator } from "../src/mocks/mockGenerator";

// ---------------------------------------------------------------------------
// analyzerScorer must accept an injected `modelResolver` and run the
// judge against it (instead of the noop model the "allow" policy returns).
// ---------------------------------------------------------------------------

describe("analyzerScorer modelResolver", () => {
  it("runs the judge against an injected resolver returning canned findings", async () => {
    const judge = mockGenerator({
      name: "judge",
      script: [
        {
          structuredOutput: {
            findings: [
              { criterion: "criterion-a", score: 0.8, assessment: "Good" },
              { criterion: "criterion-b", score: 0.6, assessment: "Acceptable" }
            ],
            overallAssessment: "Reasonable"
          }
        }
      ]
    });

    // Resolve by block name: the analyzer block is named `eval-judge-${name}`.
    const resolver = createMockModelResolver({
      generators: { "eval-judge-rubric-judge": judge }
    });

    const scorer = analyzerScorer({
      name: "rubric-judge",
      criteria: ["criterion-a", "criterion-b"],
      scoreMapping: "mean",
      modelResolver: resolver
    });

    const result = await scorer.score({
      output: "some answer",
      input: "some prompt"
    });

    expect(result.score).toBeCloseTo(0.7, 5);
    expect(result.passed).toBe(true);
  });

  it("leaves the no-resolver path unchanged (noop model → graceful 0)", async () => {
    const scorer = analyzerScorer({ criteria: ["x"] });
    const result = await scorer.score({ output: "out", input: "in" });
    expect(typeof result.score).toBe("number");
    expect(typeof result.passed).toBe("boolean");
  });
});
