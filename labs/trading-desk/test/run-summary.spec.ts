/**
 * Unit tests for the pure `buildRunSummary` projection. Mirrors
 * `report-summary-aggregate.spec.ts`: assert that each summary field traces to a
 * named stored field, and that the three run statuses (completed / stopped /
 * error) are derived correctly from session state + the decision snapshot.
 */
import { describe, expect, it } from "vitest";
import type { DecisionSnapshotState } from "../flows/analysis/decision-snapshot-resource";
import { ALL_MEMO_KEYS } from "../flows/analysis/registry";
import type { MemoState } from "../flows/analysis/resources";
import {
  buildRunSummary,
  type RunSummaryMemoInput,
} from "../flows/analysis/run-summary";
import type { SessionState } from "../flows/analysis/state";

const RAN_AT = "2026-06-25T00:00:00.000Z";
const SESSION_ID = "run_NVDA_2026-05-06_abc";

function sessionState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    ticker: "NVDA",
    date: "2026-05-06",
    costPreset: "fast",
    dataSource: "fixture",
    activePhase: "phase-5",
    maxDebateRounds: 1,
    runComplete: true,
    stoppedReason: null,
    stoppedMessage: null,
    userThesis: null,
    userThesisRationale: null,
    userThesisWarning: null,
    citationIntegrity: null,
    portfolio: null,
    selectedAccountIds: [],
    riskMandate: null,
    standingThesis: null,
    portfolioMandate: null,
    householdTickerWeightPct: null,
    scopedTickerWeightPct: null,
    ...overrides,
  };
}

function decisionSnapshot(
  overrides: Partial<DecisionSnapshotState> = {},
): DecisionSnapshotState {
  return {
    ticker: "NVDA",
    asOfDate: "2026-05-06",
    finalRating: "Overweight",
    decisionConfidence: 0.72,
    decisionSummary: "Constructive on AI demand.",
    direction: "long",
    entryPrice: null,
    stopPrice: 118.5,
    targetPrice: 165,
    sizePct: 3.5,
    holdingPeriod: "quarters",
    mandateId: "balanced",
    mandateVerdict: "clears",
    rewardToRiskLossAdjustedGlr: 2.1,
    worstCaseReturnPct: -12.4,
    capacityVetoed: false,
    hasStandingThesis: null,
    mandatePresent: null,
    policyVerdict: null,
    positionCapClamped: null,
    excluded: null,
    preGatePolicyTargetPct: null,
    decidedAt: "2026-06-25T00:00:00.000Z",
    outcomeRealizedPrice: null,
    outcomeAsOf: null,
    outcomeVerdict: null,
    ...overrides,
  };
}

/** Minimal published memo with just the fields the projection reads. */
function memoInput(
  key: string,
  agentName: string,
  state: Partial<MemoState> | null,
): RunSummaryMemoInput {
  return {
    key,
    agentName,
    state: state === null ? null : ({ status: "published", ...state } as MemoState),
  };
}

const PM_KEY = ALL_MEMO_KEYS.portfolioManager.collectionKey;

describe("buildRunSummary", () => {
  it("projects a completed run with the decision, mandate gates, and target weight", () => {
    const summary = buildRunSummary({
      sessionState: sessionState(),
      decisionSnapshot: decisionSnapshot(),
      memos: [
        memoInput("p1/fundamentals", "fundamentalsAnalyst", { status: "published" }),
        memoInput(PM_KEY, "portfolioManager", {
          status: "published",
          portfolioFit: {
            action: "add",
            targetWeightPct: 4.2,
            sizingRationale: "x",
            concentrationRisk: "x",
            convictionBasis: "x",
            suggestedAccount: "",
            currentWeightPct: 1,
            weightDeltaPct: 3.2,
            hasPortfolioContext: true,
            snapshotAsOf: null,
          },
        } as Partial<MemoState>),
      ],
      sessionId: SESSION_ID,
      ranAt: RAN_AT,
    });

    expect(summary.status).toBe("completed");
    expect(summary.sessionId).toBe(SESSION_ID);
    expect(summary.ranAt).toBe(RAN_AT);
    expect(summary.finalRating).toBe("Overweight");
    expect(summary.decisionConfidence).toBe(0.72);
    expect(summary.targetWeightPct).toBe(4.2); // from the PM memo, not the snapshot
    expect(summary.sizePct).toBe(3.5);
    expect(summary.mandateId).toBe("balanced");
    expect(summary.mandateVerdict).toBe("clears");
    expect(summary.capacityVetoed).toBe(false);
    expect(summary.rewardToRiskLossAdjustedGlr).toBe(2.1);
    expect(summary.worstCaseReturnPct).toBe(-12.4);
    expect(summary.stopReason).toBeNull();
    // Run-level fields are the harness's to fill.
    expect(summary.durationMs).toBeNull();
    expect(summary.exitCode).toBeNull();
    expect(summary.capturePath).toBeNull();
    expect(summary.memoErrors).toBe(0);
    expect(summary.memos).toHaveLength(2);
  });

  it("projects a stopped run with the stop reason and null decision fields", () => {
    const summary = buildRunSummary({
      sessionState: sessionState({
        runComplete: true,
        stoppedReason: "unresolvable-ticker",
        stoppedMessage: "Could not resolve ticker ZZZ in fixture mode.",
      }),
      decisionSnapshot: null,
      memos: [memoInput("p1/fundamentals", "fundamentalsAnalyst", null)],
      sessionId: SESSION_ID,
      ranAt: RAN_AT,
    });

    expect(summary.status).toBe("stopped");
    expect(summary.stopReason).toBe("unresolvable-ticker");
    expect(summary.stopMessage).toBe(
      "Could not resolve ticker ZZZ in fixture mode.",
    );
    expect(summary.finalRating).toBeNull();
    expect(summary.targetWeightPct).toBeNull();
    expect(summary.mandateVerdict).toBeNull();
    // A never-created memo scaffold reads back as `pending`.
    expect(summary.memos[0].status).toBe("pending");
  });

  it("counts memo errors while still reporting the run as completed", () => {
    const summary = buildRunSummary({
      sessionState: sessionState(),
      decisionSnapshot: decisionSnapshot(),
      memos: [
        memoInput("p1/fundamentals", "fundamentalsAnalyst", { status: "error" }),
        memoInput("p1/sentiment", "sentimentAnalyst", { status: "published" }),
        memoInput(PM_KEY, "portfolioManager", { status: "published" }),
      ],
      sessionId: SESSION_ID,
      ranAt: RAN_AT,
    });

    expect(summary.status).toBe("completed");
    expect(summary.memoErrors).toBe(1);
    expect(summary.memos.find((m) => m.key === "p1/fundamentals")?.status).toBe(
      "error",
    );
  });

  it("projects a completed but mandate-blind run with null mandate gates", () => {
    const summary = buildRunSummary({
      sessionState: sessionState({ riskMandate: null }),
      decisionSnapshot: decisionSnapshot({
        mandateId: null,
        mandateVerdict: null,
        capacityVetoed: null,
        rewardToRiskLossAdjustedGlr: null,
        worstCaseReturnPct: null,
      }),
      memos: [memoInput(PM_KEY, "portfolioManager", { status: "published" })],
      sessionId: SESSION_ID,
      ranAt: RAN_AT,
    });

    expect(summary.status).toBe("completed");
    expect(summary.finalRating).toBe("Overweight"); // decision still present
    expect(summary.mandateId).toBeNull();
    expect(summary.mandateVerdict).toBeNull();
    expect(summary.capacityVetoed).toBeNull();
    expect(summary.rewardToRiskLossAdjustedGlr).toBeNull();
    expect(summary.worstCaseReturnPct).toBeNull();
  });

  it("treats an empty-object decision snapshot (unwritten resource) as no decision", () => {
    // An unwritten single resource can surface as `{}` rather than null.
    const summary = buildRunSummary({
      sessionState: sessionState({ runComplete: false }),
      decisionSnapshot: {} as DecisionSnapshotState,
      memos: [],
      sessionId: SESSION_ID,
      ranAt: RAN_AT,
    });

    // No stop reason and no real decision → defensive `error`.
    expect(summary.status).toBe("error");
    expect(summary.finalRating).toBeNull();
  });

  it("echoes the mandate id from session state on a mandate-set stopped run", () => {
    const summary = buildRunSummary({
      sessionState: sessionState({
        stoppedReason: "phase-1-no-data",
        stoppedMessage: "All Phase 1 analysts errored.",
        // The resolved dial object carries the id even when the run stops early.
        riskMandate: { id: "aggressive-growth" } as SessionState["riskMandate"],
      }),
      decisionSnapshot: null,
      memos: [],
      sessionId: SESSION_ID,
      ranAt: RAN_AT,
    });

    expect(summary.status).toBe("stopped");
    expect(summary.mandateId).toBe("aggressive-growth");
  });
});
