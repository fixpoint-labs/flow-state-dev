/**
 * Regression spec — locks in the session-resource persistence layout after
 * a full `analyze` run.
 *
 * Was originally a printf-debug to investigate "no memos in DevTool".
 * Findings (preserved as assertions below):
 *
 *  - All 7 memo collection instances ARE persisted to
 *    `session.resources["memos/{phase}/{name}"]` with their full state
 *    (status, label, headline, rating, body, metrics, etc.). The framework's
 *    in-memory store path is sound.
 *  - The DevTool's session-context panel shows the memos collection as
 *    "0/7 items" because `memosCollection` declares no `prefetchWindow` —
 *    the snapshot reports a total `count` of 7 but inlines 0 item bodies.
 *    That display is by design (FIX-427 prefetched-window contract), not a
 *    persistence bug. To make the bodies appear inline in the DevTool,
 *    set `prefetchWindow: 7` (or higher) on `memosCollection`.
 *  - The shared `phase2Contributions` DefinedResource is stored under TWO
 *    different keys because two names register it: `contributions` (declared
 *    at the round-robin block level) and `p2Contributions` (declared on
 *    the flow). The round-robin writes only to `contributions`; the
 *    flow-level `p2Contributions` slot is never written. Consolidator
 *    generators read from `contributions` (they declare the same block-level
 *    name) so the contribution data still flows correctly — but the
 *    duplicate slot is a framework wart worth knowing about.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/server";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import tradingDeskFlow from "../src/flows/trading-desk/flow";

function analystThesis(label: string, headline: string) {
  return {
    structuredOutput: {
      label,
      headline,
      rating: "constructive" as const,
      metrics: [
        { key: "k1", value: "v1" },
        { key: "k2", value: "v2" },
        { key: "k3", value: "v3" },
        { key: "k4", value: "v4" },
      ],
      body: [
        { h: "Top of book", p: "Headline numbers strong.", items: null },
        { h: "Trend", p: "Direction positive.", items: null },
        { h: "Composite reading", p: "Synthesis holds.", items: null },
        { h: "Material items", p: null, items: ["Watch item A"] },
      ],
    },
  };
}

function bullStructuredOutput() {
  return {
    structuredOutput: {
      label: "Bull thesis",
      headline: "AI cap-ex runway.",
      rating: "buy" as const,
      metrics: {
        conviction: "0.7",
        horizon: "6mo",
        target: "$185",
        stop: "$132",
      },
      body: Array.from({ length: 4 }, (_, i) => ({
        h: `h${i}`,
        p: `p${i}`,
        items: null,
      })),
    },
  };
}

function bearStructuredOutput() {
  return {
    structuredOutput: {
      label: "Bear thesis",
      headline: "Priced in.",
      rating: "underweight" as const,
      metrics: {
        conviction: "0.6",
        horizon: "3mo",
        downside: "-22%",
        trigger: "earnings",
      },
      body: Array.from({ length: 4 }, (_, i) => ({
        h: `h${i}`,
        p: `p${i}`,
        items: null,
      })),
    },
  };
}

function rmStructuredOutput() {
  return {
    structuredOutput: {
      label: "Investment thesis",
      headline: "Constructive.",
      rating: "constructive" as const,
      metrics: {
        conviction: "0.55",
        horizon: "6mo",
        stance: "bullish",
        outOfScope: "Sizing",
      },
      body: Array.from({ length: 5 }, (_, i) => ({
        h: `h${i}`,
        p: `p${i}`,
        items: null,
      })),
      stance: "bullish" as const,
      convictionScore: 0.55,
      keyRisks: ["risk1"],
      keyOpportunities: ["opp1"],
      unresolvedDisagreements: ["disagreement1"],
    },
  };
}

describe("session resources are persisted after analyze run", () => {
  it("layout: 7 memo keys + contributions slot + p2Contributions slot", async () => {
    const stores = createInMemoryStores();
    const sessionId = "layout-session";

    const result = await testFlow({
      flow: tradingDeskFlow,
      action: "analyze",
      userId: "test-user",
      sessionId,
      stores,
      input: {
        ticker: "NVDA",
        date: "2026-05-06",
        costPreset: "fast" as const,
        dataSource: "fixture" as const,
      },
      generators: {
        "fundamentals-analyst-generator": mockGenerator({
          name: "fundamentals-analyst-generator",
          script: [analystThesis("Fundamentals", "h1")],
        }),
        "sentiment-analyst-generator": mockGenerator({
          name: "sentiment-analyst-generator",
          script: [analystThesis("Sentiment", "h2")],
        }),
        "news-analyst-generator": mockGenerator({
          name: "news-analyst-generator",
          script: [analystThesis("News", "h3")],
        }),
        "technical-analyst-generator": mockGenerator({
          name: "technical-analyst-generator",
          script: [analystThesis("Technical", "h4")],
        }),
        "p2-research-debate-1r-fast-roster-bullResearcher": mockGenerator({
          name: "p2-research-debate-1r-fast-roster-bullResearcher",
          script: [{ structuredOutput: { text: "Bull r1." } }],
        }),
        "p2-research-debate-1r-fast-roster-bearResearcher": mockGenerator({
          name: "p2-research-debate-1r-fast-roster-bearResearcher",
          script: [{ structuredOutput: { text: "Bear r1." } }],
        }),
        "consolidate-bull-memo": mockGenerator({
          name: "consolidate-bull-memo",
          script: [bullStructuredOutput()],
        }),
        "consolidate-bear-memo": mockGenerator({
          name: "consolidate-bear-memo",
          script: [bearStructuredOutput()],
        }),
        "research-manager-generator": mockGenerator({
          name: "research-manager-generator",
          script: [rmStructuredOutput()],
        }),
      },
      unmockedGeneratorPolicy: "error",
    });

    expect(result.status).toBe("completed");
    expect(result.error).toBeUndefined();

    const session = await stores.session.get(sessionId);
    const resources = (session?.resources ?? {}) as Record<string, unknown>;

    // The seven memo collection instances each live at their own storage key.
    const memoKeys = [
      "memos/p1/fundamentals",
      "memos/p1/sentiment",
      "memos/p1/news",
      "memos/p1/technical",
      "memos/p2/bull",
      "memos/p2/bear",
      "memos/p2/research-manager",
    ];
    for (const key of memoKeys) {
      expect(resources[key], `memo at ${key}`).toBeDefined();
      const memo = resources[key] as Record<string, unknown>;
      expect(memo.status).toBe("published");
      expect(memo.headline).toBeTruthy();
      expect(memo.body).toBeDefined();
    }

    // Both `contributions` (block-level name) and `p2Contributions`
    // (flow-level name) exist as separate slots because two declarations
    // register the same DefinedResource under different names. The
    // round-robin writes to `contributions`; the flow's `p2Contributions`
    // slot is never written. Consolidators read from `contributions`.
    expect(resources.contributions).toBeDefined();
    const contributions = resources.contributions as { entries?: unknown[] };
    expect(Array.isArray(contributions.entries)).toBe(true);
    expect((contributions.entries ?? []).length).toBeGreaterThan(0);

    expect(resources.p2Contributions).toBeDefined();
    const p2Contributions = resources.p2Contributions as { entries?: unknown[] };
    expect(Array.isArray(p2Contributions.entries)).toBe(true);
    expect((p2Contributions.entries ?? []).length).toBe(0);
  });
});
