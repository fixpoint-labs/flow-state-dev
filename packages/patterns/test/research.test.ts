import { describe, expect, it } from "vitest";
import { validateResearchReport } from "../src/research";

describe("research report citations", () => {
  it("rejects citations that no completed research task retrieved", () => {
    expect(() =>
      validateResearchReport(
        {
          question: "What changed?",
          summary: "A sourced answer.",
          findings: [{ claim: "The change shipped.", citations: ["https://invented.example/report"] }],
          sources: [{ title: "Invented", url: "https://invented.example/report" }],
        },
        new Set(["https://fixture.example/source"]),
      ),
    ).toThrow(/not retrieved/);
  });

  it("returns a report when every finding cites retrieved evidence", () => {
    const report = {
      question: "What changed?",
      summary: "A sourced answer.",
      findings: [{ claim: "The change shipped.", citations: ["https://fixture.example/source"] }],
      sources: [{ title: "Fixture", url: "https://fixture.example/source" }],
    };

    expect(validateResearchReport(report, new Set(["https://fixture.example/source"]))).toEqual(report);
  });
});
