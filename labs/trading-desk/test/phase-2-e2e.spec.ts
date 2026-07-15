/**
 * Phase 2 end-to-end integration spec.
 *
 * Exercises the full `analyze` action against an in-memory store registry
 * with every generator mocked. Asserts that:
 *   - all four Phase 1 analyst memos publish,
 *   - the Phase 2 round-robin loop's contributions land in
 *     `phase2Contributions` resource state and are visible to the
 *     consolidators,
 *   - the bull, bear, and research-manager memos publish with the right
 *     shape (including `unresolvedDisagreements`),
 *   - a single consolidator failure flips only its own memo to `error`
 *     while downstream consolidators still publish (per-step rescue
 *     isolation introduced in this PR).
 *
 * Mocks emit schema-valid `structuredOutput`. The strict-mode regression
 * is covered separately in `output-schemas-strict.spec.ts`; this spec
 * focuses on pipeline wiring and rescue semantics.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import { makeTestRepository } from "./_helpers/portfolio-repo";
import type { PortfolioRepository } from "@/db/repository";

// Collateral: this spec drives the analyze pipeline but does not test the
// portfolio. The repository (FIX-772) is mocked to an empty in-memory instance
// so `seedSession` runs portfolio-blind (no accounts → portfolio: null), the
// prior default. One repo for the file (beforeAll) — fast, never mutated.
const repoState = vi.hoisted(() => ({ repo: null as PortfolioRepository | null }));
vi.mock("@/db/portfolio-db", () => ({
  getRepository: async () => {
    if (!repoState.repo) throw new Error("test repository not initialized");
    return repoState.repo;
  },
}));

import analysisFlow from "../flows/analysis/flow";
import { ALL_MEMO_KEYS } from "../flows/analysis/registry";
import { latestMemoStatus } from "./_helpers/memo-status";

beforeAll(async () => {
  repoState.repo = await makeTestRepository();
});

const ticker = "NVDA";
const date = "2026-05-06";

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
        { h: "Material items", p: null, items: ["Watch item A", "Watch item B"] },
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
      headline: "AI cap-ex cycle still has runway.",
      rating: "buy" as const,
      metrics: {
        conviction: "0.7",
        horizon: "6–12mo",
        target: "$185",
        stop: "$132",
      },
      body: [
        { h: "The setup", p: "Durable fundamentals.", items: null },
        { h: "Why the short framing misses", p: "Bear over-weights print risk.", items: null },
        { h: "What I want to see to scale", p: "Sequential DC acceleration.", items: null },
        { h: "Risks I am not dismissing", p: "Valuation rich.", items: null },
      ],
    },
  };
}

function bearStructuredOutput() {
  return {
    structuredOutput: {
      label: "Bear thesis",
      headline: "Cap-ex pull-in priced in.",
      rating: "underweight" as const,
      metrics: {
        conviction: "0.6",
        horizon: "3–6mo",
        downside: "-22%",
        trigger: "Next earnings",
      },
      body: [
        { h: "The setup", p: "Multiple expansion has run.", items: null },
        { h: "Why the long framing misses", p: "Demand pull-forward.", items: null },
        { h: "What I want to see to scale", p: "Customer commentary cautious.", items: null },
        { h: "Risks I am not dismissing", p: "Squeeze on surprise.", items: null },
      ],
    },
  };
}

function rmStructuredOutput() {
  return {
    structuredOutput: {
      label: "Investment thesis",
      headline: "Constructive but disciplined.",
      rating: "constructive" as const,
      metrics: {
        conviction: "0.55",
        horizon: "6mo",
        stance: "bullish",
        outOfScope: "Trade sizing",
      },
      body: [
        { h: "Resolution of the debate", p: "Agree on demand durability.", items: null },
        { h: "Synthesized thesis", p: "Lean long, smaller than max.", items: null },
        { h: "What is in scope", p: "Direction and conviction.", items: null },
        { h: "What is out of scope", p: "Position sizing.", items: null },
        { h: "Key risks (named)", p: "Cycle pull-forward.", items: null },
      ],
      stance: "bullish" as const,
      convictionScore: 0.55,
      keyRisks: ["Cap-ex pull-forward", "Margin compression"],
      keyOpportunities: ["DC acceleration", "New hyperscaler wins"],
      unresolvedDisagreements: [
        "AI cap-ex cycle length",
        "Pricing-power durability in 2027",
      ],
    },
  };
}

/**
 * Build the standard generator-mock map. The Phase 2 round-robin agents are
 * `sub`-typed roster generators created by `roundRobin({...})` with names
 * `${instanceName}-roster-${agentName}`.
 */
function makeAnalystAndRosterMocks() {
  return {
    "fundamentals-analyst-generator": mockGenerator({
      name: "fundamentals-analyst-generator",
      script: [analystThesis("Fundamentals memo", "Top-line growth durable.")],
    }),
    "sentiment-analyst-generator": mockGenerator({
      name: "sentiment-analyst-generator",
      script: [analystThesis("Sentiment memo", "Sentiment constructive.")],
    }),
    "news-analyst-generator": mockGenerator({
      name: "news-analyst-generator",
      script: [analystThesis("News memo", "News flow steady.")],
    }),
    "technical-analyst-generator": mockGenerator({
      name: "technical-analyst-generator",
      script: [analystThesis("Technical memo", "Technicals supportive.")],
    }),
    "company-profile-analyst-generator": mockGenerator({
      name: "company-profile-analyst-generator",
      script: [analystThesis("Company Profile memo", "Identity resolved from provider data.")],
    }),
    // Roster agents stream plain text now (no structured outputSchema) so
    // they emit `message` items visible in the transcript. Mock text matches
    // that shape; record-contribution coerces strings via `coerceText`.
    "p2-research-debate-roster-bullResearcher": mockGenerator({
      name: "p2-research-debate-roster-bullResearcher",
      script: [{ text: "Bull round 1 contribution." }],
    }),
    "p2-research-debate-roster-bearResearcher": mockGenerator({
      name: "p2-research-debate-roster-bearResearcher",
      script: [{ text: "Bear round 1 contribution." }],
    }),
  };
}

const analyzeInput = {
  ticker,
  date,
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
};

describe("Phase 2 end-to-end", () => {
  it("happy path — all 8 memos publish and the RM memo carries unresolvedDisagreements", async () => {
    const stores = createInMemoryStores();
    const sessionId = "p2-e2e-happy";

    const consolidateBull = mockGenerator({
      name: "consolidate-bull-memo",
      script: [bullStructuredOutput()],
    });

    const result = await testFlow({
      flow: analysisFlow,
      action: "analyze",
      userId: "test-user",
      sessionId,
      stores,
      input: analyzeInput,
      generators: {
        ...makeAnalystAndRosterMocks(),
        "consolidate-bull-memo": consolidateBull,
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

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    const session = await stores.session.get(sessionId);
    expect(session).toBeDefined();

    expect(latestMemoStatus(result.items, ALL_MEMO_KEYS.fundamentals.memoKey)).toBe("published");
    expect(latestMemoStatus(result.items, ALL_MEMO_KEYS.sentiment.memoKey)).toBe("published");
    expect(latestMemoStatus(result.items, ALL_MEMO_KEYS.news.memoKey)).toBe("published");
    expect(latestMemoStatus(result.items, ALL_MEMO_KEYS.technical.memoKey)).toBe("published");
    expect(latestMemoStatus(result.items, ALL_MEMO_KEYS.companyProfile.memoKey)).toBe("published");

    const memoResources = await stores.resourceState.getAll("session", sessionId);
    const rmMemo = memoResources["memos/p2/research-manager"] as
      | { status?: string; unresolvedDisagreements?: string[] | null }
      | undefined;
    expect(rmMemo?.status).toBe("published");
    expect(rmMemo?.unresolvedDisagreements).toBeDefined();
    expect((rmMemo?.unresolvedDisagreements ?? []).length).toBeGreaterThan(0);

    const bullMemo = memoResources["memos/p2/bull"] as { status?: string } | undefined;
    const bearMemo = memoResources["memos/p2/bear"] as { status?: string } | undefined;
    expect(bullMemo?.status).toBe("published");
    expect(bearMemo?.status).toBe("published");

    // Sanity: the bull consolidator should have run exactly once and its
    // prompt should reflect prior round-robin contributions (proves the
    // shared `phase2Contributions` resource is visible across the router
    // boundary — the regression scenario behind commit e337cf91).
    expect(consolidateBull.calls).toHaveLength(1);
    const promptText = JSON.stringify(consolidateBull.calls[0]?.input ?? "");
    expect(promptText).toContain("Bull round 1 contribution.");
    expect(promptText).toContain("Bear round 1 contribution.");
  });

  it("bull-consolidator failure isolates: bull errors, bear and RM still publish", async () => {
    const stores = createInMemoryStores();
    const sessionId = "p2-e2e-bull-fails";

    const result = await testFlow({
      flow: analysisFlow,
      action: "analyze",
      userId: "test-user",
      sessionId,
      stores,
      input: analyzeInput,
      generators: {
        ...makeAnalystAndRosterMocks(),
        "consolidate-bull-memo": mockGenerator({
          name: "consolidate-bull-memo",
          // Empty script triggers the resolver's "no mock" error path,
          // which surfaces as a generator failure caught by the bull
          // sub-sequencer's rescue.
          script: [],
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

    expect(latestMemoStatus(result.items, ALL_MEMO_KEYS.bear.memoKey)).toBe("published");
    expect(latestMemoStatus(result.items, ALL_MEMO_KEYS.researchManager.memoKey)).toBe("published");

    const memoResources = await stores.resourceState.getAll("session", sessionId);
    const bullMemo = memoResources["memos/p2/bull"] as
      | { status?: string; errorMessage?: string | null }
      | undefined;
    expect(bullMemo?.status).toBe("error");
    expect(bullMemo?.errorMessage).toBeTruthy();
  });
});
