/**
 * Tests for `formatMemoBlock`'s data-grounding prefix (FIX-681).
 *
 * A memo whose primary data source was unavailable must carry an
 * unmistakable "do not synthesize" banner at the top of its rendered section,
 * so capability presets (`phase1Memos`, `phase1MemosFull`) hand downstream
 * agents an explicit skip signal. Memos with real data carry no such banner.
 */
import { describe, expect, it } from "vitest";
import { formatMemoBlock } from "../src/flows/trading-desk/lib/format";

const UNAVAILABLE_PREFIX = "(unavailable — do not synthesize from this)";

function memo(dataQuality: "full" | "partial" | "unavailable" | null) {
  return {
    status: "published",
    rating: "neutral",
    headline: "Sentiment could not be sourced.",
    metrics: { senti7d: "n/a" },
    body: [{ h: "Bottom line", p: "No usable signal.", items: null }],
    dataQuality,
  };
}

describe("formatMemoBlock data-grounding prefix", () => {
  it("prefixes an unavailable memo with the do-not-synthesize banner", () => {
    const out = formatMemoBlock("Sentiment Analyst memo", memo("unavailable"));
    expect(out).toContain(UNAVAILABLE_PREFIX);
    // The banner sits at the top of the section, directly under the heading.
    const lines = out.split("\n");
    expect(lines[0]).toBe("## Sentiment Analyst memo");
    expect(lines[1]).toBe(UNAVAILABLE_PREFIX);
  });

  it("does not prefix a full-data memo", () => {
    const out = formatMemoBlock("Sentiment Analyst memo", memo("full"));
    expect(out).not.toContain(UNAVAILABLE_PREFIX);
  });

  it("does not prefix a partial-data memo", () => {
    const out = formatMemoBlock("Sentiment Analyst memo", memo("partial"));
    expect(out).not.toContain(UNAVAILABLE_PREFIX);
  });

  it("does not prefix a memo with no dataQuality (later-phase memo)", () => {
    const out = formatMemoBlock("Trade proposal", memo(null));
    expect(out).not.toContain(UNAVAILABLE_PREFIX);
  });
});
