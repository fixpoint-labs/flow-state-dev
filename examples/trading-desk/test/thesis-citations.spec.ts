/**
 * Schema-level tests for the `citations` field on the Phase 1 thesis
 * output (FIX-612). The contract is: required key, nullable value, no
 * default — the LLM must emit either `null` or an array.
 */
import { describe, expect, it } from "vitest";
import { thesisOutputSchema } from "../src/flows/trading-desk/phase-1/thesis-schema";

const baseThesis = {
  label: "Fundamentals memo",
  headline: "Top-line growth durable.",
  rating: "constructive" as const,
  metrics: [
    { key: "revGrowth", value: "+42%" },
    { key: "opMargin", value: "62%" },
    { key: "fcfConv", value: "91%" },
    { key: "forwardPE", value: "32.5x" },
    { key: "trailingPE", value: "47.2x" },
  ],
  body: [
    { h: "Top of book", p: "Revenue +42% YoY.", items: null },
    { h: "Trend", p: "Sequential acceleration.", items: null },
    { h: "Composite reading", p: "Fundamentals supportive.", items: null },
    { h: "Material items", p: null, items: ["Cap-ex ramp"] },
  ],
  dataQuality: "full" as const,
};

describe("thesisOutputSchema.citations", () => {
  it("accepts null", () => {
    expect(() =>
      thesisOutputSchema.parse({ ...baseThesis, citations: null }),
    ).not.toThrow();
  });

  it("accepts an empty array", () => {
    expect(() =>
      thesisOutputSchema.parse({ ...baseThesis, citations: [] }),
    ).not.toThrow();
  });

  it("accepts a populated array", () => {
    expect(() =>
      thesisOutputSchema.parse({
        ...baseThesis,
        citations: [
          { url: "https://example.com/article", title: "Quarterly results" },
          { url: "https://example.com/filing", title: "10-K excerpt" },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects a parse without the citations key (required, no default)", () => {
    expect(() => thesisOutputSchema.parse(baseThesis)).toThrow();
  });

  it("rejects citation entries missing url or title", () => {
    expect(() =>
      thesisOutputSchema.parse({
        ...baseThesis,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        citations: [{ title: "no url" } as any],
      }),
    ).toThrow();
  });
});
