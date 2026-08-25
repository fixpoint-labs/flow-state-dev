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
import { createInMemoryStores, toBareStates } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import analysisFlow from "../flows/analysis/flow";
import type { DecisionSnapshotState } from "../flows/analysis/decision-snapshot-resource";
import type { ThesisRecord } from "../domain/portfolio/schema/thesis-schema";

const USER_ID = "devuser";

/** Read the household's theses collection items from the user-scope store. */
async function thesesOf(
  stores: ReturnType<typeof createInMemoryStores>,
): Promise<Record<string, ThesisRecord>> {
  return toBareStates<ThesisRecord>(await stores.resourceState.getAll("user", USER_ID));
}

const completedSnapshot: DecisionSnapshotState = {
  ticker: "NVDA",
  asOfDate: "2026-05-06",
  finalRating: "Buy",
  ratingUnanchored: false,
  periodDisclosure: null,
  decisionConfidence: 0.8,
  decisionSummary: "Compute super-cycle intact; initiate.",
  direction: "long",
  entryPrice: null,
  stopPrice: 120,
  targetPrice: 180,
  reassessBelowPrice: null,
  invalidateAbovePrice: null,
  sizePct: 4,
  holdingPeriod: "quarters",
  mandateId: null,
  mandateVerdict: null,
  rewardToRiskLossAdjustedGlr: null,
  worstCaseReturnPct: null,
  capacityVetoed: null,
  hasStandingThesis: null,
  mandatePresent: null,
  policyVerdict: null,
  positionCapClamped: null,
  excluded: null,
  preGatePolicyTargetPct: null,
  evidenceVerdict: null,
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

  /**
   * FIX-780 §9 — adopting a FLAT report. There is no position, so there is no
   * stop and no target, and therefore no price tripwire. The existing null
   * guards deliver this with no new code; this test is what proves the flat
   * snapshot shape actually reaches them, and that the monitoring levels do NOT
   * quietly become a stop (turning them into tripwires belongs with outcome
   * tracking, FIX-763 — not here).
   */
  it("adopts a flat report with no price levels and no price tripwire", async () => {
    const sessionId = "run_nvda_flat";
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
            tradingDeskDecisionSnapshot: {
              ...completedSnapshot,
              finalRating: "Hold" as const,
              direction: "flat" as const,
              sizePct: 0,
              stopPrice: null,
              targetPrice: null,
              reassessBelowPrice: 195,
              invalidateAbovePrice: 320,
            },
            "memos/p3/trader": {
              status: "published",
              agentName: "trader",
              invalidationCriteria: ["A weekly close above $320."],
            },
          },
        },
      },
    });

    expect(result.status).toBe("completed");
    const thesis = (await thesesOf(stores))["theses/NVDA"];
    expect(thesis.stopPrice).toBeNull();
    expect(thesis.targetPrice).toBeNull();
    // A tripwire here would be a stop on a position the desk did not take.
    expect(thesis.tripwires).toEqual([]);
  });

  /**
   * FIX-780 — the LEGACY flat snapshot, which is the durable-data case.
   *
   * A report COMPLETED before the write-side gate and merely reopened never
   * re-runs the Phase 5 write, so its stored snapshot still carries the flat
   * call's two monitoring levels under `stopPrice` / `targetPrice`. Adopting
   * that verbatim persisted a standing thesis with a stop and a live tripwire on
   * a position the desk declined to take — the report defect escaping into user
   * data with an alert attached.
   *
   * The monitoring keys are OMITTED here, not set to null: that missing-key
   * shape is what a pre-fix record actually reads back as, and it is the shape a
   * `=== null` guard gets wrong (BP-030).
   *
   * The numbers must not be re-filed under the monitoring names either — nothing
   * in the record says which of the two was which.
   */
  it("adopts a LEGACY flat report with no levels and no tripwire (never re-files the pair)", async () => {
    const sessionId = "run_nvda_flat_legacy";
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
            tradingDeskDecisionSnapshot: {
              ...completedSnapshot,
              finalRating: "Hold" as const,
              direction: "flat" as const,
              sizePct: 0,
              // The mislabeled pair, exactly as a pre-fix run stored it.
              stopPrice: 320,
              targetPrice: 195,
            },
            "memos/p3/trader": {
              status: "published",
              agentName: "trader",
              invalidationCriteria: ["The thesis broke down."],
            },
          },
        },
      },
    });

    expect(result.status).toBe("completed");
    const thesis = (await thesesOf(stores))["theses/NVDA"];
    // Absent stays absent: no named level survives adoption.
    expect(thesis.stopPrice).toBeNull();
    expect(thesis.targetPrice).toBeNull();
    // The defect: a stop tripwire on a stand-aside call, from a number the desk
    // never meant as a stop.
    expect(thesis.tripwires).toEqual([]);
    // Neither number is re-filed anywhere on the record under any name — that
    // would be a guess wearing a stored record's authority.
    expect(JSON.stringify(thesis)).not.toContain("320");
    expect(JSON.stringify(thesis)).not.toContain("195");
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
