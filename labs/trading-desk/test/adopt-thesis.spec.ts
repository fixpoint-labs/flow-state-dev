/**
 * Integration test for the `adoptThesis` action (FIX-760), driven through
 * `testFlow`.
 *
 * Intent encoded: at report completion, one action DERIVES the standing thesis
 * from the session's stored decision snapshot + the trader memo (server-side,
 * never trusted from the client) and writes it into the user-scoped `theses`
 * collection with the originating `sourceSessionId` captured automatically. A run
 * with no completed decision — or a snapshot whose ticker doesn't match the
 * session — has nothing valid to adopt and the action throws.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import analysisFlow from "../src/flows/analysis/flow";
import type { DecisionSnapshotState } from "../src/flows/analysis/decision-snapshot-resource";
import type { ThesisRecord } from "../src/flows/portfolio/thesis-schema";

const USER_ID = "devuser";

/** Read the household's theses collection items from the user-scope store. */
async function thesesOf(
  stores: ReturnType<typeof createInMemoryStores>,
): Promise<Record<string, ThesisRecord>> {
  return (await stores.resourceState.getAll("user", USER_ID)) as Record<string, ThesisRecord>;
}

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

let stores: ReturnType<typeof createInMemoryStores>;
beforeEach(() => {
  stores = createInMemoryStores();
});

describe("adoptThesis action", () => {
  it("derives a thesis from the decision snapshot + trader memo and captures the report link", async () => {
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
              // trader output schema) — the adopt mapping joins them into the
              // thesis's freeform text column, not the array verbatim.
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

    const thesis = (await thesesOf(stores))["theses/NVDA"];
    expect(thesis).toBeDefined();
    expect(thesis.entryRationale).toContain("Buy decision");
    expect(thesis.entryRationale).toContain("Compute super-cycle intact");
    expect(thesis.invalidationConditions).toBe(
      "- Data-center capex guide cut two quarters running.\n- Gross margin compresses below 60%.",
    );
    expect(thesis.timeHorizon).toBe("quarters");
    expect(thesis.targetPrice).toBe(180);
    expect(thesis.stopPrice).toBe(120);
    expect(thesis.tripwires).toEqual([
      { kind: "price", note: "Price through the stop level", level: 120, byDate: null },
    ]);
    // Report linkage captured automatically.
    expect(thesis.sourceSessionId).toBe(sessionId);
  });

  it("throws when there is no completed decision to adopt", async () => {
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
    expect((await thesesOf(stores))["theses/ZZZ"]).toBeUndefined();
  });

  it("refuses a snapshot whose ticker doesn't match the session (stale guard)", async () => {
    // Defense in depth: even if a prior run's NVDA snapshot somehow survived onto
    // a session now analyzing AAPL, adopt must not save the wrong name.
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
    const theses = await thesesOf(stores);
    expect(theses["theses/AAPL"]).toBeUndefined();
    expect(theses["theses/NVDA"]).toBeUndefined();
  });
});
