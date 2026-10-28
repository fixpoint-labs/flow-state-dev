/**
 * A coding run's result card says what the run did, not the run's JSON: the
 * notice line carries the output as text, and only its `answer` is for a person.
 */
import { describe, expect, it } from "vitest";
import { resultSummary } from "../src/lib/result-summary";

const run = { issue: "t-1", answer: "Appended the line to README.md.", branch: "conductor/t-1/a-very-long-branch-name", commits: 1, judged: true, review: "accepted" };

describe("resultSummary", () => {
  it("shows a coding run's answer instead of its JSON", () => {
    expect(resultSummary(JSON.stringify(run))).toBe("Appended the line to README.md.");
  });

  it("still finds the answer when the notice cut the JSON short after it", () => {
    const cut = `${JSON.stringify(run).slice(0, 80)}…`;
    expect(() => JSON.parse(cut)).toThrow();
    expect(resultSummary(cut)).toBe("Appended the line to README.md.");
  });

  it("keeps escapes in the answer as the run wrote them", () => {
    expect(resultSummary(JSON.stringify({ answer: 'Said "done".\nTwo lines.' }))).toBe('Said "done".\nTwo lines.');
  });

  it("leaves a researcher's prose, and JSON with no answer, as they came", () => {
    expect(resultSummary("Acme ships **weekly**.")).toBe("Acme ships **weekly**.");
    expect(resultSummary('{"rows":3}')).toBe('{"rows":3}');
  });
});
