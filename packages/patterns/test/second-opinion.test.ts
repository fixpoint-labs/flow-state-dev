/** Configuration behavior of the installable second-opinion kit. */
import { describe, expect, it } from "vitest";
import { secondOpinion, createSecondOpinionFlow, type SecondOpinionConfig } from "../src/second-opinion";

const valid = { draftModel: "scripted/draft", reviewModel: "scripted/review" };

describe("second opinion configuration", () => {
  it.each([
    { draftModel: "" }, { reviewModel: "" }, { maxRounds: 0 },
    { maxRounds: 5 }, { maxRounds: 1.5 }, { maxRounds: Infinity },
    { unknown: true }, { analyzers: [] }, { judge: {} }, { synthesizer: {} },
  ])("rejects invalid config %j", (override) => {
    expect(() => secondOpinion({ ...valid, ...override } as SecondOpinionConfig)).toThrow();
    expect(() => createSecondOpinionFlow({ ...valid, ...override } as SecondOpinionConfig)).toThrow();
  });

  it("accepts different models, bounded rounds, and a custom flow kind", () => {
    expect(() => secondOpinion({ ...valid, maxRounds: 4, flowKind: "checked-answer" })).not.toThrow();
  });
});
