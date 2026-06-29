/**
 * Integration test for the `adoptThesis` action (FIX-760), driven through
 * `testFlow`.
 *
 * Intent encoded: at report completion, one action DERIVES the standing thesis
 * from the session's stored decision snapshot + the trader memo (server-side,
 * never trusted from the client) and writes it to the app-owned `app.theses`
 * table with the originating `sourceSessionId` captured automatically. A run with
 * no completed decision has nothing to adopt and the action throws.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import { makeTestRepository } from "./_helpers/portfolio-repo";
import type { PortfolioRepository } from "@/src/db/repository";
import type { DecisionSnapshotState } from "../src/flows/analysis/decision-snapshot-resource";

const repoState = vi.hoisted(() => ({ repo: null as PortfolioRepository | null }));
vi.mock("@/lib/portfolio-db", () => ({
  getRepository: async () => {
    if (!repoState.repo) throw new Error("test repository not initialized");
    return repoState.repo;
  },
}));

import analysisFlow from "../src/flows/analysis/flow";

const USER_ID = "devuser";

const completedSnapshot: DecisionSnapshotState = {
  ticker: "NVDA",
  asOfDate: "2026-05-06",
  finalRating: "Buy",
  decisionConfidence: 0.8,
  decisionSummary: "Compute super-cycle intact; initiate.",
  direction: "long",
  entryPrice: null,
  stopPrice: 120,
  targetPrice: 180,
  sizePct: 4,
  holdingPeriod: "quarters",
  mandateId: null,
  mandateVerdict: null,
  rewardToRiskLossAdjustedGlr: null,
  worstCaseReturnPct: null,
  capacityVetoed: null,
  hasStandingThesis: null,
  decidedAt: "2026-06-25T00:00:00.000Z",
  outcomeRealizedPrice: null,
  outcomeAsOf: null,
  outcomeVerdict: null,
};

beforeEach(async () => {
  repoState.repo = await makeTestRepository();
});

describe("adoptThesis action", () => {
  it("derives a thesis from the decision snapshot + trader memo and captures the report link", async () => {
    const stores = createInMemoryStores();
    const sessionId = "run_nvda_done";

    const result = await testFlow({
      flow: analysisFlow,
      action: "adoptThesis",
      userId: USER_ID,
      sessionId,
      stores,
      input: {},
      seed: {
        session: {
          state: { ticker: "NVDA", date: "2026-05-06", runComplete: true },
          resources: {
            tradingDeskDecisionSnapshot: completedSnapshot,
            "memos/p3/trader": {
              status: "published",
              agentName: "trader",
              // The real trader memo emits an ARRAY of short strings (matches the
              // trader output schema) — the adopt mapping must join them into the
              // thesis's freeform text column, not write the array verbatim.
              invalidationCriteria: [
                "Data-center capex guide cut two quarters running.",
                "Gross margin compresses below 60%.",
              ],
            },
          },
        },
      },
    });

    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ ticker: "NVDA" });

    const thesis = await repoState.repo!.getThesis(USER_ID, "NVDA");
    expect(thesis).not.toBeNull();
    expect(thesis?.entryRationale).toContain("Buy decision");
    expect(thesis?.entryRationale).toContain("Compute super-cycle intact");
    // The trader's array of criteria is joined into the thesis's freeform text.
    expect(thesis?.invalidationConditions).toBe(
      "- Data-center capex guide cut two quarters running.\n- Gross margin compresses below 60%.",
    );
    expect(thesis?.timeHorizon).toBe("quarters");
    expect(thesis?.targetPrice).toBe(180);
    expect(thesis?.stopPrice).toBe(120);
    // A price tripwire is derived from the stop level for FIX-763's checks.
    expect(thesis?.tripwires).toEqual([
      { kind: "price", note: "Price through the stop level", level: 120, byDate: null },
    ]);
    // Report linkage captured automatically.
    expect(thesis?.sourceSessionId).toBe(sessionId);
  });

  it("throws when there is no completed decision to adopt", async () => {
    const stores = createInMemoryStores();
    const result = await testFlow({
      flow: analysisFlow,
      action: "adoptThesis",
      userId: USER_ID,
      sessionId: "run_stopped",
      stores,
      input: {},
      seed: { session: { state: { ticker: "ZZZ", runComplete: true } } },
    });

    expect(result.status).not.toBe("completed");
    expect(await repoState.repo!.getThesis(USER_ID, "ZZZ")).toBeNull();
  });

  it("refuses a snapshot whose ticker doesn't match the session (stale guard)", async () => {
    // Defense in depth: even if a prior run's NVDA snapshot somehow survived onto
    // a session now analyzing AAPL, adopt must not save the wrong name.
    const stores = createInMemoryStores();
    const result = await testFlow({
      flow: analysisFlow,
      action: "adoptThesis",
      userId: USER_ID,
      sessionId: "run_mismatch",
      stores,
      input: {},
      seed: {
        session: {
          state: { ticker: "AAPL", date: "2026-05-06", runComplete: true },
          resources: { tradingDeskDecisionSnapshot: completedSnapshot }, // ticker NVDA
        },
      },
    });

    expect(result.status).not.toBe("completed");
    expect(await repoState.repo!.getThesis(USER_ID, "AAPL")).toBeNull();
    expect(await repoState.repo!.getThesis(USER_ID, "NVDA")).toBeNull();
  });
});
