/**
 * Unit spec for `formatReferencesConsulted` — the shared "references consulted"
 * ledger the synthesis phases read so they reuse a link the desk already
 * surfaced instead of re-searching the same ground.
 *
 * The ledger is DERIVED from the `citations` already stored on every memo (no
 * separate resource), so these tests drive a mock memos collection and assert
 * the three intent-bearing behaviors: suppress the tag when nothing was cited
 * (the `fast`-preset steady state), attribute each link to the citing agent, and
 * dedup a URL cited by more than one agent (what preserves the cache-reuse the
 * feature is for).
 */
import { describe, expect, it } from "vitest";
import { formatReferencesConsulted } from "../src/flows/analysis/lib/format";
import {
  PHASE_1_MEMO_KEYS,
  PHASE_3_MEMO_KEYS,
  PHASE_5_MEMO_KEYS,
} from "../src/flows/analysis/registry";

/** A mock memos collection: resolves a memo state by collection key, or
 *  `undefined` for an unknown/pending key (matching `getOptional`). */
function mockMemos(byKey: Record<string, unknown>) {
  return {
    getOptional: async (k: string) =>
      k in byKey ? { state: byKey[k] } : undefined,
  };
}

describe("formatReferencesConsulted", () => {
  it("returns null (tag suppressed) when no memo has cited anything", async () => {
    // The steady state on the `fast` preset: nobody fetched, so every memo's
    // `citations` is null/absent and the ledger has nothing to show.
    const memos = mockMemos({
      [PHASE_3_MEMO_KEYS.trader.collectionKey]: { citations: null },
      [PHASE_1_MEMO_KEYS.fundamentals.collectionKey]: {},
    });
    expect(await formatReferencesConsulted(memos)).toBeNull();
  });

  it("renders each cited URL with its title and the citing agent's role", async () => {
    const memos = mockMemos({
      [PHASE_1_MEMO_KEYS.news.collectionKey]: {
        citations: [{ url: "https://ex.com/a", title: "Article A" }],
      },
      [PHASE_3_MEMO_KEYS.trader.collectionKey]: {
        citations: [{ url: "https://ex.com/b", title: "Peer comp B" }],
      },
    });
    const out = await formatReferencesConsulted(memos);
    expect(out).toContain("https://ex.com/a");
    expect(out).toContain("Article A");
    expect(out).toContain("News Analyst");
    expect(out).toContain("https://ex.com/b");
    expect(out).toContain("Trader");
  });

  it("dedups a URL cited by more than one agent (first citer wins)", async () => {
    // The point of the ledger: a later agent should see a URL the desk already
    // pulled exactly once, not once per citer — that's what lets it reuse the
    // link instead of re-searching.
    const memos = mockMemos({
      [PHASE_1_MEMO_KEYS.news.collectionKey]: {
        citations: [{ url: "https://ex.com/x", title: "Shared source" }],
      },
      [PHASE_5_MEMO_KEYS.portfolioManager.collectionKey]: {
        citations: [{ url: "https://ex.com/x", title: "Shared source (PM)" }],
      },
    });
    const out = (await formatReferencesConsulted(memos)) ?? "";
    const occurrences = out.split("https://ex.com/x").length - 1;
    expect(occurrences).toBe(1);
    // First citer in ALL_MEMO_KEYS order (Phase 1 before Phase 5) owns the line.
    expect(out).toContain("News Analyst");
  });
});
