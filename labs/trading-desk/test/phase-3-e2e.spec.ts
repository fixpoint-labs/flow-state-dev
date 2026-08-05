/**
 * Phase 3 end-to-end integration spec.
 *
 * Drives the full `analyze` action with every generator mocked. Asserts:
 *   - the Phase 3 trader memo publishes with all seven extension fields
 *     populated;
 *   - a trader-generator failure isolates: only `memos/p3/trader` flips to
 *     `error` while Phase 1 / Phase 2 memos still publish (per-step rescue).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createInMemoryStores, toBareStates } from "@flow-state-dev/engine";
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

function traderStructuredOutput() {
  return {
    structuredOutput: {
      label: "Trade proposal",
      headline: "Long NVDA, half-position.",
      rating: "long" as const,
      metrics: {
        direction: "long",
        size: "1.4%",
        stop: "$132",
        target: "$185",
        conviction: "0.62",
      },
      body: [
        { h: "Reading the thesis", p: "Constructive but disciplined.", items: null },
        { h: "Proposal", p: "Long 1.4% of NAV; stop $132; target $185.", items: null },
        { h: "Why this size", p: "Mid conviction; below max long.", items: null },
        { h: "Exit discipline", p: "Stop on weekly close below $132.", items: null },
      ],
      direction: "long" as const,
      sizePct: 1.4,
      stopPrice: 132,
      targetPrice: 185,
      holdingPeriod: "months" as const,
      invalidationCriteria: [
        "weekly close below $132",
        "DC revenue print misses",
      ],
      dependsOn: ["AI cap-ex cycle length"],
      citations: null,
    },
  };
}

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
    "p2-research-debate-roster-bullResearcher": mockGenerator({
      name: "p2-research-debate-roster-bullResearcher",
      script: [{ text: "Bull round 1 contribution." }],
    }),
    "p2-research-debate-roster-bearResearcher": mockGenerator({
      name: "p2-research-debate-roster-bearResearcher",
      script: [{ text: "Bear round 1 contribution." }],
    }),
    "trader-approach-generator": mockGenerator({
      name: "trader-approach-generator",
      script: [{ text: "I'll weigh the thesis stance against the analyst evidence." }],
    }),
  };
}

const analyzeInput = {
  ticker,
  date,
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
};

describe("Phase 3 end-to-end", () => {
  it("happy path — trader memo publishes with all extension fields populated", async () => {
    const stores = createInMemoryStores();
    const sessionId = "p3-e2e-happy";

    const trader = mockGenerator({
      name: "trader-generator",
      script: [traderStructuredOutput()],
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
        "trader-generator": trader,
      },
      unmockedGeneratorPolicy: "error",
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    const memoResources = toBareStates(await stores.resourceState.getAll("session", sessionId));
    const traderMemo = memoResources["memos/p3/trader"] as
      | {
          status?: string;
          direction?: string | null;
          sizePct?: number | null;
          stopPrice?: number | null;
          targetPrice?: number | null;
          holdingPeriod?: string | null;
          invalidationCriteria?: string[] | null;
          dependsOn?: string[] | null;
          conviction?: number | null;
        }
      | undefined;
    expect(traderMemo?.status).toBe("published");
    expect(traderMemo?.direction).toBe("long");
    expect(traderMemo?.sizePct).toBe(1.4);
    expect(traderMemo?.stopPrice).toBe(132);
    expect(traderMemo?.targetPrice).toBe(185);
    expect(traderMemo?.holdingPeriod).toBe("months");
    expect(traderMemo?.invalidationCriteria?.length).toBeGreaterThan(0);
    expect(traderMemo?.dependsOn?.length).toBeGreaterThan(0);
    expect(traderMemo?.conviction).toBeCloseTo(0.62);

    // The trader's user prompt reads off the published RM memo via
    // `ctx.resources.memos.getOptional(...)`.
    expect(trader.calls).toHaveLength(1);
    const promptText = JSON.stringify(trader.calls[0]?.input ?? "");
    expect(promptText).toContain("Investment thesis");

    // Approach preamble streams as a `message` item with
    // `agentName: "trader"` — the transcript-pane signal that the
    // trader is "thinking out loud" before its structured memo lands.
    const traderMessages = result.items.filter(
      (item) =>
        (item as { agentName?: string }).agentName === "trader" &&
        (item as { type?: string }).type === "message",
    );
    expect(traderMessages.length).toBeGreaterThan(0);
  });

  it("trader failure isolates: only trader errors, prior phases still publish", async () => {
    const stores = createInMemoryStores();
    const sessionId = "p3-e2e-trader-fails";

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
        "trader-generator": mockGenerator({
          name: "trader-generator",
          script: [],
        }),
      },
      unmockedGeneratorPolicy: "error",
    });

    expect(result.status).toBe("completed");

    expect(latestMemoStatus(result.items, ALL_MEMO_KEYS.bull.memoKey)).toBe("published");
    expect(latestMemoStatus(result.items, ALL_MEMO_KEYS.bear.memoKey)).toBe("published");
    expect(latestMemoStatus(result.items, ALL_MEMO_KEYS.researchManager.memoKey)).toBe("published");

    const memoResources = toBareStates(await stores.resourceState.getAll("session", sessionId));
    const traderMemo = memoResources["memos/p3/trader"] as
      | { status?: string; errorMessage?: string | null }
      | undefined;
    expect(traderMemo?.status).toBe("error");
    expect(traderMemo?.errorMessage).toBeTruthy();
  });
});
