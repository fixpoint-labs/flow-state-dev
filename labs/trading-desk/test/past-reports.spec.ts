/**
 * Tests for the decision-record spine (Past Reports tracer, Slice 0).
 *
 * Two surfaces:
 *
 *   1. `parseReportRow` — the pure, browser-safe metadata → row parser.
 *      Cases encode the robustness intent: complete rows parse richly; legacy,
 *      malformed, and stopped rows degrade gracefully and never throw.
 *
 *   2. The PM-commit write spine — `commitPortfolioManagerMemo` writes the
 *      durable `decisionSnapshot` resource and additively merges the
 *      `decision` + `reportStatus: "complete"` session metadata WITHOUT
 *      clobbering the four tuple keys `findSessionForTuple` relies on. Plus a
 *      stop-guard badging the row `reportStatus: "stopped"`.
 *
 * The write-side tests drive a minimal single-action flow through `testFlow`
 * against an in-memory store, then read the persisted session metadata and
 * resource state back — the only faithful way to inspect `setMetadata` and
 * single-resource `patchState`, neither of which `testBlock` surfaces in
 * `stateChanges`.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { createInMemoryStores, type StoreRegistry } from "@flow-state-dev/server";
import { testFlow } from "@flow-state-dev/testing";
import { checkTickerResolvable } from "../src/flows/trading-desk/flow";
import { commitPortfolioManagerMemo } from "../src/flows/trading-desk/agents/portfolio-manager/writer";
import { decisionSnapshotResource } from "../src/flows/trading-desk/decision-snapshot-resource";
import { memosCollection } from "../src/flows/trading-desk/resources";
import {
  parseReportRow,
  relativeTime,
  reportRowTuple,
  type ReportRow,
  type ReportSessionSummary,
} from "../src/flows/trading-desk/report-index";
import { sessionStateSchema } from "../src/flows/trading-desk/state";
import {
  valuationSpineResource,
  type ValuationSpineState,
} from "../src/flows/trading-desk/valuation-spine-resource";

// ── 1. parseReportRow ────────────────────────────────────────────────

const tuple = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast",
  dataSource: "fixture",
};

function summary(
  overrides: Partial<ReportSessionSummary> & { metadata?: Record<string, unknown> },
): ReportSessionSummary {
  return {
    id: "sess-1",
    createdAt: 1_000,
    ...overrides,
  };
}

describe("parseReportRow", () => {
  it("complete row: parses decision, status complete, sortKey = decidedAt", () => {
    const decidedAt = "2026-05-06T12:00:00.000Z";
    const row = parseReportRow(
      summary({
        title: "NVDA · 2026-05-06 · fast · fixture",
        metadata: {
          ...tuple,
          decision: {
            finalRating: "Overweight",
            decisionConfidence: 0.72,
            summary: "Constructive on data-center demand.",
            decidedAt,
          },
          reportStatus: "complete",
        },
      }),
    );
    expect(row.ticker).toBe("NVDA");
    expect(row.status).toBe("complete");
    expect(row.decision).not.toBeNull();
    expect(row.decision?.finalRating).toBe("Overweight");
    expect(row.decision?.decisionConfidence).toBe(0.72);
    expect(row.sortKey).toBe(Date.parse(decidedAt));
  });

  it("legacy row: tuple only → decision null, status in-progress, sortKey = createdAt", () => {
    const row = parseReportRow(summary({ createdAt: 4_242, metadata: { ...tuple } }));
    expect(row.decision).toBeNull();
    expect(row.status).toBe("in-progress");
    expect(row.sortKey).toBe(4_242);
    // Legacy rows stay listable: tuple-derived title, real ticker.
    expect(row.ticker).toBe("NVDA");
    expect(row.title).toBe("NVDA · 2026-05-06 · fast · fixture");
  });

  it("malformed decision: bad shape safe-parses to null without throwing", () => {
    const row = parseReportRow(
      summary({ metadata: { ...tuple, decision: { junk: true }, reportStatus: "complete" } }),
    );
    expect(row.decision).toBeNull();
    // The row still renders — status survives even when decision is junk.
    expect(row.status).toBe("complete");
  });

  it("stopped row: status stopped, decision may be null", () => {
    const row = parseReportRow(summary({ metadata: { ...tuple, reportStatus: "stopped" } }));
    expect(row.status).toBe("stopped");
    expect(row.decision).toBeNull();
  });
});

// ── 1b. Past Reports list surface (Slice 1) ──────────────────────────

/** Build a complete-row SessionSummary with a given ticker + decidedAt, so
 *  list ordering can be asserted by `sortKey` (= Date.parse(decidedAt)). */
function completeSummary(
  id: string,
  ticker: string,
  decidedAt: string,
  createdAt: number,
): ReportSessionSummary {
  return {
    id,
    createdAt,
    title: `${ticker} · 2026-05-06 · fast · fixture`,
    metadata: {
      ...tuple,
      ticker,
      decision: {
        finalRating: "Hold",
        decisionConfidence: 0.5,
        summary: "x",
        decidedAt,
      },
      reportStatus: "complete",
    },
  };
}

/** Mirror of the app's `findSessionForTuple` keying, used to prove the
 *  open-report tuple-sync contract at the logic level (the harness has no DOM). */
function findSessionForTuple(
  sessions: ReadonlyArray<ReportSessionSummary>,
  t: { ticker: string; date: string; costPreset: string; dataSource: string },
): string | undefined {
  return sessions.find((s) => {
    const md = s.metadata;
    return (
      md?.ticker === t.ticker &&
      md?.date === t.date &&
      md?.costPreset === t.costPreset &&
      md?.dataSource === t.dataSource
    );
  })?.id;
}

describe("Past Reports list ordering", () => {
  it("sorts rows newest-first by sortKey (decidedAt for complete rows)", () => {
    const sessions = [
      completeSummary("old", "AAPL", "2026-05-01T00:00:00.000Z", 1),
      completeSummary("new", "NVDA", "2026-05-06T00:00:00.000Z", 2),
      completeSummary("mid", "TSLA", "2026-05-03T00:00:00.000Z", 3),
    ];
    const ordered = sessions
      .map((s) => parseReportRow(s))
      .sort((a, b) => b.sortKey - a.sortKey)
      .map((r) => r.id);
    expect(ordered).toEqual(["new", "mid", "old"]);
  });

  it("interleaves in-progress (createdAt-keyed) and complete (decidedAt-keyed) rows in one desc list", () => {
    // A legacy/in-progress row has no decision, so it sorts by createdAt. A
    // recently-created in-progress row should outrank an older completed one.
    const completed = completeSummary("done", "NVDA", "2026-05-01T00:00:00.000Z", 100);
    const inProgress = summary({ id: "live-now", createdAt: Date.parse("2026-05-06T00:00:00.000Z"), metadata: { ...tuple } });
    const ordered = [completed, inProgress]
      .map((s) => parseReportRow(s))
      .sort((a, b) => b.sortKey - a.sortKey)
      .map((r) => r.id);
    expect(ordered).toEqual(["live-now", "done"]);
  });
});

describe("open-report tuple sync (the #1 bug, spec 02 §6.5)", () => {
  it("the row's tuple resolves findSessionForTuple back to the opened id", () => {
    // The opened report's tuple differs from the current header inputs. The fix
    // is: set the header to the ROW's tuple before selectSession, so the sync
    // effect (which re-selects findSessionForTuple(headerTuple)) is a no-op
    // pointing at the same id we just opened — never snapping selection away.
    const opened = completeSummary("opened", "TSLA", "2026-05-06T00:00:00.000Z", 1);
    const other = completeSummary("other", "NVDA", "2026-05-06T00:00:00.000Z", 2);
    const sessions = [opened, other];

    const row = parseReportRow(opened);
    const newHeaderTuple = reportRowTuple(row);

    // After the handler sets the header to the row's tuple, the sync effect
    // resolves to exactly the opened id — confirming no re-dispatch / mis-key.
    expect(findSessionForTuple(sessions, newHeaderTuple)).toBe("opened");
  });

  it("reportRowTuple round-trips the four keys from the parsed row", () => {
    const row: ReportRow = parseReportRow(
      summary({ metadata: { ...tuple, ticker: "AMD", date: "2026-05-06", costPreset: "full", dataSource: "live" } }),
    );
    expect(reportRowTuple(row)).toEqual({
      ticker: "AMD",
      date: "2026-05-06",
      costPreset: "full",
      dataSource: "live",
    });
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-05-06T12:00:00.000Z");
  it("renders sub-minute as 'just now'", () => {
    expect(relativeTime(now - 10_000, now)).toBe("just now");
  });
  it("renders minutes / hours / yesterday / days", () => {
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe("2h ago");
    expect(relativeTime(now - 26 * 3_600_000, now)).toBe("yesterday");
    expect(relativeTime(now - 4 * 86_400_000, now)).toBe("4d ago");
  });
  it("falls back to ISO date past a week", () => {
    expect(relativeTime(Date.parse("2026-04-01T00:00:00.000Z"), now)).toBe("2026-04-01");
  });
  it("treats future timestamps (clock skew) as 'just now'", () => {
    expect(relativeTime(now + 60_000, now)).toBe("just now");
  });
});

// ── 2. PM-commit write spine ─────────────────────────────────────────

const commitFlow = defineFlow({
  kind: "trading-desk-past-reports-test",
  actions: {
    commitPm: { block: commitPortfolioManagerMemo },
    stopTicker: { block: checkTickerResolvable },
  },
  session: { stateSchema: sessionStateSchema },
  resources: {
    memos: memosCollection,
    valuationSpine: valuationSpineResource,
    decisionSnapshot: decisionSnapshotResource,
  },
})({ id: "test" });

const baseSessionState = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  activePhase: "phase-5" as const,
  maxDebateRounds: 1,
  memoStatus: { portfolioManager: "writing" as const },
  runComplete: false,
};

/** Minimal `writing` PM memo so `publishMemo`'s `.get()` resolves. */
function seededPmMemo() {
  return {
    status: "writing" as const,
    agentName: "portfolioManager",
    agentTeam: "pm" as const,
    phaseId: "p5",
    ticker: "NVDA",
    date: "2026-05-06",
    startedAt: new Date().toISOString(),
  };
}

/** Trader memo carrying the typed numeric mirrors the snapshot sources. */
function seededTraderMemo() {
  return {
    direction: "long",
    stopPrice: 132,
    targetPrice: 185,
    sizePct: 1.4,
    holdingPeriod: "months",
  };
}

function portfolioDecision(
  finalRating: "Sell" | "Underweight" | "Hold" | "Overweight" | "Buy",
) {
  return {
    label: "PortfolioDecision",
    headline: "Final decision.",
    rating: finalRating,
    metrics: {
      rating: finalRating,
      ticker: "NVDA",
      window: "6 months",
      size: "1.4%",
      stop: "$132",
      target: "$185",
    },
    body: [
      { h: "Executive summary", p: "The decision.", items: null },
      { h: "Investment thesis", p: "Cited.", items: null },
      { h: "What supports this rating", p: "Reasons.", items: null },
      { h: "What argues against", p: "Counterpoints.", items: null },
      { h: "Critical near-term inflection", p: "Watch.", items: null },
      { h: "Pre-committed exit triggers", p: "Exit.", items: null },
      { h: "Why not the adjacent tier", p: "Adjacent reasoning.", items: null },
      { h: "Deferred follow-on", p: "Defer.", items: null },
      { h: "Citations", p: "Sources.", items: null },
    ],
    finalRating,
    // Long, so the 160-char truncation is observable.
    decisionSummary: "S".repeat(200),
    decisionConfidence: 0.62,
    acceptedAdjustments: {
      sizing: { applied: true, reasoning: "Aligned with risk team." },
      holdingPeriod: { applied: false, reasoning: "Disagree on horizon." },
      invalidation: { applied: true, reasoning: "Stop level holds." },
    },
    keyDependencies: ["AI cap-ex cycle length"],
    asymmetricEdge: "Street underprices the data-center attach rate.",
    nearTermCatalyst: "Q2 print lands in three weeks.",
    invalidationTrigger: "Attach rate flat two quarters running.",
    traderDependencyDispositions: [] as {
      index: number;
      status: "carried" | "dropped";
      note: string;
    }[],
    primaryScenario: "Data-center beat, +12%",
    ratingOverrideReason: "",
    portfolioFit: {
      action: "initiate" as const,
      targetWeightPct: 2.5,
      sizingRationale: "Sized without portfolio context (none supplied).",
      concentrationRisk: "",
      suggestedAccount: "",
      convictionBasis: "",
    },
  };
}

/** A valuation spine whose rating envelope bands the PM to [Sell, Hold]. Only
 *  `envelope` drives `clampRatingToBand`; the rest satisfies the schema. With a
 *  PM rating of "Buy" and an empty override reason, the clamp pins finalRating
 *  down to the ceiling "Hold" — so the snapshot must record "Hold", not "Buy". */
function clampingSpine(): ValuationSpineState {
  return {
    ticker: "NVDA",
    asOf: "2026-05-06",
    expectedReturn: {
      shareholderYield: null,
      sustainableGrowth: null,
      expectedReturn: null,
      hurdle: 0.08,
      excessReturn: null,
      basis: "none",
      lowConfidence: true,
    },
    fairValue: {
      justifiedPE: null,
      fairValue: null,
      marginOfSafety: null,
      method: "none",
      available: false,
    },
    setupScore: {
      score: null,
      value: null,
      quality: null,
      factor: null,
      momentum: null,
      evidenceBasis: "thin",
    },
    envelope: {
      absoluteRating: "Sell",
      relativeRating: "Underweight",
      implied: "Sell",
      floor: "Sell",
      ceiling: "Hold",
      rationale: "Test envelope: band [Sell, Hold] forces a downward clamp.",
    },
    valuationMethod: "equity-multiples",
    evidenceBasis: "thin",
  };
}

/** Pre-create the session record with the four tuple keys in metadata AND the
 *  base session state, so the additive metadata merge can be verified to
 *  preserve the tuple keys. `testFlow`'s seeding is idempotent — it only
 *  `set()`s a missing session — so this pre-set is the one that survives; the
 *  state must therefore be supplied here, not via `seed.session.state`. */
async function preSeedSessionWithTuple(
  stores: StoreRegistry,
  sessionId: string,
): Promise<void> {
  const now = Date.now();
  await stores.session.set(
    sessionId,
    {
      id: sessionId,
      flowKind: commitFlow.kind,
      userId: "test-user",
      orgId: undefined,
      title: "NVDA · 2026-05-06 · fast · fixture",
      // Tuple keys live flat on the record's metadata bag — matching the real
      // app's `createSession({ metadata: tuple })`. `findSessionForTuple` reads
      // `session.metadata.ticker` etc., so the additive `setMetadata` merge must
      // keep these as siblings of the new `decision`/`reportStatus` keys.
      metadata: { ...tuple },
      latestRequestId: undefined,
      state: { ...baseSessionState },
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: [],
    },
    "any",
  );
}

describe("PM commit writes snapshot + reports-index metadata", () => {
  it("writes the decision snapshot, merges decision + reportStatus, preserves tuple keys", async () => {
    const stores = createInMemoryStores();
    const sessionId = "commit-spine";
    await preSeedSessionWithTuple(stores, sessionId);

    const result = await testFlow({
      flow: commitFlow,
      action: "commitPm",
      userId: "test-user",
      sessionId,
      stores,
      input: portfolioDecision("Overweight"),
      seed: {
        session: {
          state: baseSessionState,
          resources: {
            "memos/p5/portfolio-manager": seededPmMemo(),
            "memos/p3/trader": seededTraderMemo(),
          },
        },
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    // (a) The durable snapshot resource — keyed by its `ref`.
    const resources = await stores.resourceState.getAll("session", sessionId);
    const snapshot = resources["tradingDeskDecisionSnapshot"] as
      | {
          ticker?: string;
          finalRating?: string;
          decisionConfidence?: number;
          direction?: string | null;
          entryPrice?: number | null;
          stopPrice?: number | null;
          targetPrice?: number | null;
          sizePct?: number | null;
          holdingPeriod?: string | null;
          outcomeRealizedPrice?: number | null;
          outcomeAsOf?: string | null;
          outcomeVerdict?: string | null;
          decidedAt?: string;
        }
      | undefined;
    expect(snapshot).toBeDefined();
    expect(snapshot?.ticker).toBe("NVDA");
    // finalRating === post-clamp value (no spine seeded → unclamped Overweight).
    expect(snapshot?.finalRating).toBe("Overweight");
    expect(snapshot?.decisionConfidence).toBeCloseTo(0.62);
    expect(snapshot?.direction).toBe("long");
    // Trader-sourced numeric mirrors.
    expect(snapshot?.stopPrice).toBe(132);
    expect(snapshot?.targetPrice).toBe(185);
    expect(snapshot?.sizePct).toBe(1.4);
    expect(snapshot?.holdingPeriod).toBe("months");
    // entryPrice reserved null; outcome fields null on write.
    expect(snapshot?.entryPrice).toBeNull();
    expect(snapshot?.outcomeRealizedPrice).toBeNull();
    expect(snapshot?.outcomeAsOf).toBeNull();
    expect(snapshot?.outcomeVerdict).toBeNull();
    expect(typeof snapshot?.decidedAt).toBe("string");

    // (b) The session-metadata reports-index row. The runtime's `setMetadata`
    // shallow-merges into the record's flat `metadata` bag, so `decision` /
    // `reportStatus` land as siblings of the tuple keys.
    const session = await stores.session.get(sessionId);
    const md = (session?.metadata ?? {}) as Record<string, unknown>;
    const decision = md.decision as
      | { finalRating?: string; decisionConfidence?: number; summary?: string; decidedAt?: string }
      | undefined;
    expect(md.reportStatus).toBe("complete");
    expect(decision?.finalRating).toBe("Overweight");
    expect(decision?.decisionConfidence).toBeCloseTo(0.62);
    // Summary truncated to ≤160 chars.
    expect((decision?.summary ?? "").length).toBeLessThanOrEqual(160);

    // (c) The four tuple keys are preserved (not clobbered) — the keying
    // contract `findSessionForTuple` depends on.
    expect(md.ticker).toBe("NVDA");
    expect(md.date).toBe("2026-05-06");
    expect(md.costPreset).toBe("fast");
    expect(md.dataSource).toBe("fixture");
  });

  it("records the CLAMPED finalRating (not the raw PM rating) when the spine bands it out", async () => {
    // The decision-of-record must capture the rating the desk ACTED ON. The
    // spine bands the PM to [Sell, Hold]; the PM emits "Buy" with no override
    // reason, so the commit clamps to "Hold". If the snapshot stored the raw
    // "Buy", every future outcome score would grade a decision never made.
    const stores = createInMemoryStores();
    const sessionId = "commit-spine-clamped";
    await preSeedSessionWithTuple(stores, sessionId);

    const result = await testFlow({
      flow: commitFlow,
      action: "commitPm",
      userId: "test-user",
      sessionId,
      stores,
      input: portfolioDecision("Buy"),
      seed: {
        session: {
          state: baseSessionState,
          resources: {
            "memos/p5/portfolio-manager": seededPmMemo(),
            "memos/p3/trader": seededTraderMemo(),
            // Single session resource — seeded by its `ref`.
            valuationSpine: clampingSpine(),
          },
        },
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    // The durable snapshot records the post-clamp "Hold", never the raw "Buy".
    const resources = await stores.resourceState.getAll("session", sessionId);
    const snapshot = resources["tradingDeskDecisionSnapshot"] as
      | { finalRating?: string }
      | undefined;
    expect(snapshot?.finalRating).toBe("Hold");

    // The reports-index row mirrors the same clamped rating.
    const session = await stores.session.get(sessionId);
    const md = (session?.metadata ?? {}) as Record<string, unknown>;
    const decision = md.decision as { finalRating?: string } | undefined;
    expect(decision?.finalRating).toBe("Hold");
  });
});

describe("stop guard badges the reports-index row", () => {
  it("checkTickerResolvable badges reportStatus: stopped on an unresolvable ticker", async () => {
    const stores = createInMemoryStores();
    const sessionId = "stopped-row";
    await preSeedSessionWithTuple(stores, sessionId);

    const result = await testFlow({
      flow: commitFlow,
      action: "stopTicker",
      userId: "test-user",
      sessionId,
      stores,
      // An unresolvable ticker in fixture mode trips the guard.
      input: {
        ticker: "ZZZZ_UNRESOLVABLE",
        date: "2026-05-06",
        costPreset: "fast" as const,
        dataSource: "fixture" as const,
      },
      seed: { session: { state: baseSessionState } },
    });
    expect(result.error).toBeUndefined();

    const session = await stores.session.get(sessionId);
    const md = (session?.metadata ?? {}) as Record<string, unknown>;
    expect(md.reportStatus).toBe("stopped");
    // Tuple keys untouched by the stopped badge.
    expect(md.ticker).toBe("NVDA");
    expect(md.dataSource).toBe("fixture");
  });
});
