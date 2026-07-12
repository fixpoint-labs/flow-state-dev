/**
 * Unit tests for the pure `buildRunArtifacts` projection — the read seam the
 * eval suite (FIX-790) scores against.
 *
 * Intent encoded: the bundle carries the full decision substrate (summary +
 * every resource + every memo body), and a never-written resource normalizes to
 * `null` — never a partial `{}` or an empty `{entries: []}` transcript — so the
 * downstream completeness checks can tell "absent" from "malformed". Mirrors
 * `run-summary.spec.ts` (assert each field traces to a named stored input).
 */
import { describe, expect, it } from "vitest";
import type { LensConvergenceState } from "../src/flows/analysis/agents/lenses/lens-convergence-resource";
import type { DecisionSnapshotState } from "../src/flows/analysis/decision-snapshot-resource";
import { ALL_MEMO_KEYS } from "../src/flows/analysis/registry";
import type { MemoState } from "../src/flows/analysis/resources";
import {
  buildRunArtifacts,
  runArtifactsStateSchema,
} from "../src/flows/analysis/run-artifacts";
import type { RunSummaryMemoInput } from "../src/flows/analysis/run-summary";
import type { RewardToRiskState } from "../src/flows/analysis/reward-to-risk-resource";
import type { SessionState } from "../src/flows/analysis/state";
import type { ValuationSpineState } from "../src/flows/analysis/valuation-spine-resource";

const RAN_AT = "2026-06-25T00:00:00.000Z";
const SESSION_ID = "run_NVDA_2026-05-06_abc";

function sessionState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    ticker: "NVDA",
    date: "2026-05-06",
    costPreset: "full",
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
    decidedAt: "2026-06-25T00:00:00.000Z",
    outcomeRealizedPrice: null,
    outcomeAsOf: null,
    outcomeVerdict: null,
    ...overrides,
  };
}

const spine: ValuationSpineState = {
  ticker: "NVDA",
  asOf: "2026-05-06",
  expectedReturn: {
    shareholderYield: 0.01,
    sustainableGrowth: 0.14,
    expectedReturn: 0.15,
    hurdle: 0.09,
    excessReturn: 0.06,
    basis: "fcf",
    lowConfidence: false,
  },
  fairValue: {
    justifiedPE: 30,
    fairValue: 150,
    marginOfSafety: 0.1,
    method: "justified-pe",
    available: true,
  },
  dcf: null,
  triangulation: null,
  setupScore: {
    score: 0.6,
    value: 0.5,
    quality: 0.7,
    factor: 0.6,
    momentum: 0.6,
    evidenceBasis: "sufficient",
  },
  envelope: {
    absoluteRating: "Buy",
    relativeRating: "Overweight",
    implied: "Overweight",
    floor: "Hold",
    ceiling: "Buy",
    rationale: "x",
  },
  valuationMethod: "ev-multiples",
  evidenceBasis: "sufficient",
};

const rewardToRisk: RewardToRiskState = {
  expectedValuePct: 8,
  expectedGainPct: 20,
  expectedLossPct: -10,
  glr: 2,
  lossAdjustedGlr: 2.1,
  worstCaseReturnPct: -12.4,
  noDownside: false,
  evidenceBasis: "sufficient",
  lossAversion: 1.5,
  mandateId: "balanced",
};

const lensConvergence: LensConvergenceState = {
  verdicts: [],
  netLean: 0.4,
  agreementScore: 0.75,
  classification: "mixed",
  majorityStance: "bullish",
  dissenters: ["forensic-skeptic"],
};

/** Minimal published memo carrying the schema-required identity fields plus
 *  whatever the projection reads. */
function memoInput(
  key: string,
  agentName: string,
  state: Partial<MemoState> | null,
): RunSummaryMemoInput {
  return {
    key,
    agentName,
    state:
      state === null
        ? null
        : ({
            status: "published",
            agentName,
            agentTeam: "analyst",
            ticker: "NVDA",
            date: "2026-05-06",
            phaseId: "p1",
            ...state,
          } as MemoState),
  };
}

/** All 24 registered memos, published, keyed off the registry. */
function allMemos(): RunSummaryMemoInput[] {
  return Object.values(ALL_MEMO_KEYS).map((entry) =>
    memoInput(entry.collectionKey, entry.agentName, { status: "published" }),
  );
}

describe("buildRunArtifacts", () => {
  it("projects every resource and every ALL_MEMO_KEYS entry; validates against the schema", () => {
    const bundle = buildRunArtifacts({
      sessionState: sessionState({ userThesis: "AI capex is durable." }),
      decisionSnapshot: decisionSnapshot(),
      memos: allMemos(),
      valuationSpine: spine,
      rewardToRisk,
      lensConvergence,
      p2Contributions: {
        entries: [{ round: 1, agentName: "bullResearcher", text: "Bull opens." }],
      },
      sessionId: SESSION_ID,
      ranAt: RAN_AT,
    });

    // The bundle is a valid RunArtifactsBundle (output validation would pass).
    expect(() => runArtifactsStateSchema.parse(bundle)).not.toThrow();

    // Summary reused verbatim.
    expect(bundle.summary.status).toBe("completed");
    expect(bundle.summary.finalRating).toBe("Overweight");
    expect(bundle.summary.sessionId).toBe(SESSION_ID);

    // Every resource present.
    expect(bundle.valuationSpine?.ticker).toBe("NVDA");
    expect(bundle.rewardToRisk?.lossAdjustedGlr).toBe(2.1);
    expect(bundle.lensConvergence?.classification).toBe("mixed");
    expect(bundle.decisionSnapshot?.finalRating).toBe("Overweight");
    expect(bundle.hasUserThesis).toBe(true);
    expect(bundle.p2Contributions?.entries).toHaveLength(1);

    // Every registered memo (24 on full: 20 static + 4 lens).
    expect(bundle.memos).toHaveLength(Object.keys(ALL_MEMO_KEYS).length);
    expect(bundle.memos).toHaveLength(24);
    expect(bundle.memos.every((m) => m.state?.status === "published")).toBe(true);
  });

  it("normalizes absent resources and memo scaffolds to null, never throwing", () => {
    const bundle = buildRunArtifacts({
      sessionState: sessionState({
        costPreset: "fast",
        runComplete: true,
        stoppedReason: "unresolvable-ticker",
        stoppedMessage: "Could not resolve ticker ZZZ in fixture mode.",
      }),
      decisionSnapshot: null,
      memos: Object.values(ALL_MEMO_KEYS).map((entry) =>
        memoInput(entry.collectionKey, entry.agentName, null),
      ),
      valuationSpine: null,
      rewardToRisk: null,
      lensConvergence: null,
      p2Contributions: null,
      sessionId: SESSION_ID,
      ranAt: RAN_AT,
    });

    expect(() => runArtifactsStateSchema.parse(bundle)).not.toThrow();
    expect(bundle.summary.status).toBe("stopped");
    expect(bundle.valuationSpine).toBeNull();
    expect(bundle.rewardToRisk).toBeNull();
    expect(bundle.lensConvergence).toBeNull();
    expect(bundle.decisionSnapshot).toBeNull();
    expect(bundle.riskMandate).toBeNull();
    expect(bundle.hasUserThesis).toBe(false);
    expect(bundle.p2Contributions).toBeNull();
    // Every memo body is null (scaffold never created), but the entry is present.
    expect(bundle.memos).toHaveLength(24);
    expect(bundle.memos.every((m) => m.state === null)).toBe(true);
  });

  it("treats an empty-object decision snapshot (unwritten resource) as null", () => {
    const bundle = buildRunArtifacts({
      sessionState: sessionState({ runComplete: false }),
      decisionSnapshot: {} as DecisionSnapshotState,
      memos: [],
      valuationSpine: {} as ValuationSpineState,
      rewardToRisk: {} as RewardToRiskState,
      lensConvergence: {} as LensConvergenceState,
      p2Contributions: null,
      sessionId: SESSION_ID,
      ranAt: RAN_AT,
    });

    // `{}` reads normalize to null via the required-field guards.
    expect(bundle.decisionSnapshot).toBeNull();
    expect(bundle.valuationSpine).toBeNull();
    expect(bundle.rewardToRisk).toBeNull();
    expect(bundle.lensConvergence).toBeNull();
  });

  it("normalizes a never-written transcript (parses to {entries: []}) to null, not {entries: []}", () => {
    const bundle = buildRunArtifacts({
      sessionState: sessionState(),
      decisionSnapshot: decisionSnapshot(),
      memos: [],
      valuationSpine: spine,
      rewardToRisk,
      lensConvergence,
      // The round-robin resource schema defaults `entries` to `[]`, so a
      // never-written resource surfaces as a non-null empty transcript.
      p2Contributions: { entries: [] },
      sessionId: SESSION_ID,
      ranAt: RAN_AT,
    });

    // Absent Phase-2 substrate → null, so the debate-engagement judge skips it
    // rather than grading an empty debate.
    expect(bundle.p2Contributions).toBeNull();
  });
});
