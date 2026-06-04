/**
 * Tests for `find_counter_evidence` (FIX-679) — the closed-world debater
 * tool. The audit rejected open-web fetch for Bull/Bear, so the contract
 * these tests pin is: every match comes from inside the desk's own context
 * (an analyst memo or the running transcript), never the open web. A match
 * source is always prefixed `memo:` or `contribution:`; nothing else can
 * appear.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { find_counter_evidence } from "../src/flows/trading-desk/phase-2/tools/find_counter_evidence";
import { PHASE_1_MEMO_KEYS } from "../src/flows/trading-desk/agents";
import { memosCollection, phase2Contributions } from "../src/flows/trading-desk/resources";
import { sessionStateSchema } from "../src/flows/trading-desk/state";

const flow = defineFlow({
  kind: "p2-counter-evidence-test",
  actions: { run: { block: find_counter_evidence } },
  session: { stateSchema: sessionStateSchema },
  resources: { memos: memosCollection, p2Contributions: phase2Contributions },
})({ id: "test" });

const baseSessionState = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "full" as const,
  dataSource: "fixture" as const,
  activePhase: "phase-2" as const,
  maxDebateRounds: 2,
  memoStatus: {},
};

function fundamentalsMemo(paragraph: string) {
  return {
    status: "published" as const,
    agentName: PHASE_1_MEMO_KEYS.fundamentals.agentName,
    agentTeam: "analyst" as const,
    phaseId: "p1",
    ticker: "NVDA",
    date: "2026-05-06",
    headline: "memo",
    body: [{ h: "Margins", p: paragraph, items: null }],
  };
}

async function run(opts: {
  claim: string;
  opposingMemo:
    | "fundamentals"
    | "sentiment"
    | "news"
    | "technical"
    | "companyProfile";
  memoParagraph?: string;
  entries?: Array<{ round: number; agentName: string; text: string }>;
}) {
  const resources: Record<string, unknown> = {
    p2Contributions: { entries: opts.entries ?? [] },
  };
  if (opts.memoParagraph !== undefined) {
    resources[PHASE_1_MEMO_KEYS.fundamentals.memoKey] = fundamentalsMemo(
      opts.memoParagraph,
    );
  }
  const result = await testBlock(find_counter_evidence, {
    input: { claim: opts.claim, opposingMemo: opts.opposingMemo },
    flow,
    session: { state: baseSessionState, resources },
  });
  return result;
}

describe("find_counter_evidence", () => {
  it("returns matches from the named analyst memo body", async () => {
    const result = await run({
      claim: "operating margin is expanding strongly",
      opposingMemo: "fundamentals",
      memoParagraph: "Operating margin compressed 220bps to 28.4% on supply costs.",
    });
    expect(result.error).toBeNull();
    const matches = (result.output as { matches: Array<{ source: string; excerpt: string }> })
      .matches;
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].source).toBe("memo:fundamentals");
    expect(matches[0].excerpt).toContain("Operating margin compressed");
  });

  it("returns matches from prior debate contributions", async () => {
    const result = await run({
      claim: "demand is collapsing across hyperscalers",
      opposingMemo: "sentiment",
      entries: [
        {
          round: 1,
          agentName: "bearResearcher",
          text: "Hyperscaler demand is collapsing as capex guidance turns cautious.",
        },
      ],
    });
    expect(result.error).toBeNull();
    const matches = (result.output as { matches: Array<{ source: string; excerpt: string }> })
      .matches;
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((m) => m.source === "contribution:bearResearcher:r1")).toBe(true);
  });

  it("only ever returns text that exists in the closed world (no open web)", async () => {
    const memoParagraph = "Operating margin compressed 220bps to 28.4% on supply costs.";
    const contributionText = "Margin compression is structural, not a one-off this quarter.";
    const result = await run({
      claim: "operating margin is expanding strongly this quarter",
      opposingMemo: "fundamentals",
      memoParagraph,
      entries: [{ round: 1, agentName: "bullResearcher", text: contributionText }],
    });
    expect(result.error).toBeNull();
    const matches = (result.output as { matches: Array<{ source: string; excerpt: string }> })
      .matches;
    expect(matches.length).toBeGreaterThan(0);
    // The load-bearing invariant: every returned excerpt is verbatim content
    // from a seeded closed-world source (the memo section "Margins" + paragraph,
    // or the contribution). If an open-web fetch path ever leaked in, the
    // excerpt would not appear in this blob and this would fail — that's the
    // regression guard, not the source prefix.
    const closedWorldBlob = `Margins ${memoParagraph} ${contributionText}`;
    for (const m of matches) {
      expect(m.source).toMatch(/^(memo:|contribution:)/);
      const text = m.excerpt.replace(/…$/, "");
      expect(closedWorldBlob).toContain(text);
    }
  });

  it("returns no matches when nothing in the closed world is relevant", async () => {
    const result = await run({
      claim: "lithium supply constraints in chile",
      opposingMemo: "fundamentals",
      memoParagraph: "Operating margin compressed 220bps to 28.4%.",
    });
    expect(result.error).toBeNull();
    const matches = (result.output as { matches: Array<{ source: string }> }).matches;
    expect(matches).toEqual([]);
  });

  it("still matches a verbatim hit when the claim is all stopwords (empty token set)", async () => {
    // Regression: the verbatim bonus must be non-zero even when every claim
    // word is filtered out as a stopword/short token, otherwise a direct hit
    // scores 0 and is dropped.
    const claim = "is not in it or by"; // 18 chars, all stopwords
    const result = await run({
      claim,
      opposingMemo: "fundamentals",
      memoParagraph: `The risk is not in it or by itself material.`,
    });
    expect(result.error).toBeNull();
    const matches = (result.output as { matches: Array<{ source: string }> }).matches;
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].source).toBe("memo:fundamentals");
  });

  it("rejects a claim shorter than the schema minimum", async () => {
    const result = await testBlock(find_counter_evidence, {
      input: { claim: "short", opposingMemo: "fundamentals" },
      flow,
      session: { state: baseSessionState, resources: { p2Contributions: { entries: [] } } },
    });
    expect(result.error).not.toBeNull();
  });
});
