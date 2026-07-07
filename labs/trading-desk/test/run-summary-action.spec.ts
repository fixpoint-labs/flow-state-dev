/**
 * Integration test for the `runSummary` read action, driven through `testFlow`
 * against an in-memory store.
 *
 * Intent encoded: the action reads the desk's OWN durable records for the
 * current session — the decision snapshot (single resource), the memos
 * collection, and the session stop-state — and returns the projected
 * `RunSummary` as its output. We seed those records as a prior `analyze` run
 * would have written them, then assert `result.output` reflects them. This is
 * the headless-harness contract in miniature: the summary is recoverable from
 * stored state after the run, with zero model spend.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import analysisFlow from "../src/flows/analysis/flow";
import type { DecisionSnapshotState } from "../src/flows/analysis/decision-snapshot-resource";
import type { RunSummary } from "../src/flows/analysis/run-summary";

const completedSnapshot: DecisionSnapshotState = {
  ticker: "NVDA",
  asOfDate: "2026-05-06",
  finalRating: "Buy",
  decisionConfidence: 0.8,
  decisionSummary: "Strong setup.",
  direction: "long",
  entryPrice: null,
  stopPrice: 120,
  targetPrice: 180,
  sizePct: 4,
  holdingPeriod: "quarters",
  mandateId: "balanced",
  mandateVerdict: "clears",
  rewardToRiskLossAdjustedGlr: 2.4,
  worstCaseReturnPct: -10,
  capacityVetoed: false,
  hasStandingThesis: null,
  decidedAt: "2026-06-25T00:00:00.000Z",
  outcomeRealizedPrice: null,
  outcomeAsOf: null,
  outcomeVerdict: null,
};

describe("runSummary action", () => {
  it("projects a completed run from the stored decision snapshot + memos", async () => {
    const stores = createInMemoryStores();
    const sessionId = "run_nvda_completed";

    const result = await testFlow({
      flow: analysisFlow,
      action: "runSummary",
      userId: "cli-user",
      sessionId,
      stores,
      input: {},
      seed: {
        session: {
          state: {
            ticker: "NVDA",
            date: "2026-05-06",
            costPreset: "fast",
            dataSource: "fixture",
            runComplete: true,
          },
          resources: {
            // Single resource — keyed by its `ref`.
            tradingDeskDecisionSnapshot: completedSnapshot,
            // Collection items — keyed by their full storage key.
            "memos/p1/fundamentals": { status: "published", agentName: "fundamentalsAnalyst" },
            "memos/p5/portfolio-manager": {
              status: "published",
              agentName: "portfolioManager",
              portfolioFit: {
                action: "add",
                targetWeightPct: 5.5,
                sizingRationale: "x",
                concentrationRisk: "x",
                convictionBasis: "x",
                suggestedAccount: "",
                currentWeightPct: 2,
                weightDeltaPct: 3.5,
                hasPortfolioContext: true,
                snapshotAsOf: null,
              },
            },
          },
        },
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    const summary = result.output as RunSummary;
    expect(summary.status).toBe("completed");
    expect(summary.sessionId).toBe(sessionId);
    expect(summary.ticker).toBe("NVDA");
    expect(summary.finalRating).toBe("Buy");
    expect(summary.targetWeightPct).toBe(5.5); // read off the PM memo
    expect(summary.mandateVerdict).toBe("clears");
    expect(summary.sizePct).toBe(4);
    // Every registered memo is reported; the two seeded are published, the rest
    // pending (never created).
    expect(summary.memoErrors).toBe(0);
    const pm = summary.memos.find((m) => m.key === "p5/portfolio-manager");
    expect(pm?.status).toBe("published");
    const trader = summary.memos.find((m) => m.key === "p3/trader");
    expect(trader?.status).toBe("pending");
  });

  it("projects a stopped run with no decision snapshot", async () => {
    const stores = createInMemoryStores();
    const sessionId = "run_zzz_stopped";

    const result = await testFlow({
      flow: analysisFlow,
      action: "runSummary",
      userId: "cli-user",
      sessionId,
      stores,
      input: {},
      seed: {
        session: {
          state: {
            ticker: "ZZZ",
            date: "2026-05-06",
            costPreset: "fast",
            dataSource: "fixture",
            runComplete: true,
            stoppedReason: "unresolvable-ticker",
            stoppedMessage: "Could not resolve ticker ZZZ in fixture mode.",
          },
        },
      },
    });

    expect(result.error).toBeUndefined();
    const summary = result.output as RunSummary;
    expect(summary.status).toBe("stopped");
    expect(summary.stopReason).toBe("unresolvable-ticker");
    expect(summary.finalRating).toBeNull();
    expect(summary.targetWeightPct).toBeNull();
  });
});
