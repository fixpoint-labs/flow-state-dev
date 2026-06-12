/**
 * Tests for the Research Manager reasoning-order fix (FIX-679).
 *
 * The vulnerability: the RM could pick "constructive" as the headline rating
 * (path of least resistance) and back-fill `stance` / `convictionScore` to be
 * consistent. The fix moves the rating to LAST and ties it to a verbatim
 * restatement of the gate condition. We can't unit-test the model's reasoning
 * order directly, so we pin the two observable seams: (1) the prompt instructs
 * the model to compute the rating last, and (2) the writer accepts an
 * order-honest, non-constructive output (cautious + bearish + high conviction)
 * — i.e. the schema does not force the rating to agree with a default.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { commitResearchManagerMemo } from "../src/flows/analysis/agents/research/writer";
import { memosCollection } from "../src/flows/analysis/resources";
import { sessionStateSchema } from "../src/flows/analysis/state";
import { latestMemoStatus } from "./_helpers/memo-status";

const RM_PROMPT_PATH = path.join(
  process.cwd(),
  "src/flows/analysis/agents/research/prompts/research-manager.prompt.md",
);

const flow = defineFlow({
  kind: "p2-rm-reasoning-order-test",
  actions: { commitRM: { block: commitResearchManagerMemo } },
  session: { stateSchema: sessionStateSchema },
  resources: { memos: memosCollection },
})({ id: "test" });

const baseSessionState = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "full" as const,
  dataSource: "fixture" as const,
  activePhase: "phase-2" as const,
  maxDebateRounds: 2,
};

const seededRmMemo = {
  "memos/p2/research-manager": {
    status: "writing" as const,
    agentName: "researchManager",
    agentTeam: "research" as const,
    phaseId: "p2",
    ticker: "NVDA",
    date: "2026-05-06",
    startedAt: new Date().toISOString(),
  },
};

const cautiousThesis = {
  label: "Investment thesis",
  headline: "Bear case carries an unrebutted load-bearing risk; stay cautious.",
  rating: "cautious" as const,
  metrics: { conviction: "0.70", horizon: "3mo", stance: "bearish", outOfScope: "Sizing" },
  body: [
    { h: "Resolution of the debate", p: "Both agree demand is decelerating.", items: null },
    { h: "Synthesized thesis", p: "Lean short.", items: null },
    { h: "What is in scope", p: "Direction.", items: null },
    { h: "What is out of scope", p: "Sizing.", items: null },
    {
      h: "Key risks (named)",
      p: "Rating = cautious because stance is bearish with convictionScore ≥ 0.60.",
      items: null,
    },
  ],
  stance: "bearish" as const,
  convictionScore: 0.7,
  keyRisks: ["Capex guidance cut"],
  keyOpportunities: ["Short squeeze risk only"],
  unresolvedDisagreements: ["Cycle length"],
};

describe("RM reasoning-order fix", () => {
  it("the RM prompt instructs the model to compute the rating LAST", () => {
    const prompt = readFileSync(RM_PROMPT_PATH, "utf8");
    expect(prompt).toContain("compute rating LAST");
    expect(prompt).toContain("Do not write `rating` first");
  });

  it("the writer accepts an order-honest cautious/bearish/high-conviction thesis", async () => {
    const result = await testBlock(commitResearchManagerMemo, {
      input: cautiousThesis,
      flow,
      session: { state: baseSessionState, resources: seededRmMemo },
    });
    expect(result.error).toBeNull();
    expect(
      latestMemoStatus(result.items, "memos/p2/research-manager"),
    ).toBe("published");
  });
});
