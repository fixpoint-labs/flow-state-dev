/**
 * Regression spec — locks in the session-resource persistence layout after
 * a full `analyze` run.
 *
 * Was originally a printf-debug to investigate "no memos in DevTool".
 * Findings (preserved as assertions below):
 *
 *  - All 8 memo collection instances ARE persisted to
 *    `session.resources["memos/{phase}/{name}"]` with their full state
 *    (status, label, headline, rating, body, metrics, etc.). The framework's
 *    in-memory store path is sound.
 *  - The DevTool's session-context panel shows the memos collection as
 *    "0/8 items" because `memosCollection` declares no `prefetchWindow` —
 *    the snapshot reports a total `count` of 8 but inlines 0 item bodies.
 *    That display is by design (FIX-427 prefetched-window contract), not a
 *    persistence bug. To make the bodies appear inline in the DevTool,
 *    set `prefetchWindow: 8` (or higher) on `memosCollection`.
 *  - The shared `phase2Contributions` `DefinedResource` is persisted to a
 *    single slot regardless of how many accessor names register it. Both
 *    the round-robin's `contributions` accessor and the flow-level
 *    `p2Contributions` accessor resolve to the same canonical storage key,
 *    so there is one entries array — not two (FIX-591).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createInMemoryStores, toStates } from "@flow-state-dev/engine";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import { makeTestRepository } from "./_helpers/portfolio-repo";
import type { PortfolioRepository } from "@/db/repository";

// Collateral: this spec locks the session-resource layout after an analyze run
// and does not test the portfolio. The repository (FIX-772) is mocked to an
// empty in-memory instance so `seedSession` runs portfolio-blind. One repo for
// the file (beforeAll) — fast, never mutated.
const repoState = vi.hoisted(() => ({ repo: null as PortfolioRepository | null }));
vi.mock("@/db/portfolio-db", () => ({
  getRepository: async () => {
    if (!repoState.repo) throw new Error("test repository not initialized");
    return repoState.repo;
  },
}));

import analysisFlow from "../flows/analysis/flow";

beforeAll(async () => {
  repoState.repo = await makeTestRepository();
});

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
      citations: null,
      dataQuality: "full" as const,
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
  it("layout: 8 memo keys + single shared contributions slot", async () => {
    const stores = createInMemoryStores();
    const sessionId = "layout-session";

    const result = await testFlow({
      flow: analysisFlow,
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
        "company-profile-analyst-generator": mockGenerator({
          name: "company-profile-analyst-generator",
          script: [analystThesis("Company Profile", "h5")],
        }),
        "p2-research-debate-roster-bullResearcher": mockGenerator({
          name: "p2-research-debate-roster-bullResearcher",
          script: [{ text: "Bull r1." }],
        }),
        "p2-research-debate-roster-bearResearcher": mockGenerator({
          name: "p2-research-debate-roster-bearResearcher",
          script: [{ text: "Bear r1." }],
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

    // Collection-instance and single-resource state live in the
    // ResourceStateStore (FIX-689), keyed per-resource, not inline on the record.
    const resources = (toStates(await stores.resourceState.getAll("session", sessionId))) as Record<
      string,
      unknown
    >;

    // The eight memo collection instances each live at their own storage key.
    const memoKeys = [
      "memos/p1/fundamentals",
      "memos/p1/sentiment",
      "memos/p1/news",
      "memos/p1/technical",
      "memos/p1/company-profile",
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

    // Phase 2's round-robin uses `accessorKey: "p2Contributions"`, which
    // matches the accessor names the consolidator and flow-level registration
    // use — one shared name across writers and readers. FIX-591 additionally
    // guarantees that even if a different accessor name appeared somewhere,
    // it would resolve to the same canonical storage key for this ref.
    expect(resources.p2Contributions).toBeDefined();
    const p2Contributions = resources.p2Contributions as { entries?: unknown[] };
    expect(Array.isArray(p2Contributions.entries)).toBe(true);
    expect((p2Contributions.entries ?? []).length).toBeGreaterThan(0);
    expect(resources.contributions).toBeUndefined();
  });
});
