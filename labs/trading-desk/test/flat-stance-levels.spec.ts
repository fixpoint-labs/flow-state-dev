/**
 * FIX-780 — a flat call's price levels are named as monitoring levels, never as
 * a stop and a target.
 *
 * The defect these tests exist to catch: a run that decided NOT to take a
 * position still wrote its two watch levels into `stopPrice` / `targetPrice`, so
 * a "Hold, no position" report read `stop 320 · target 195` — a short setup with
 * the stop above the target — on the screen, on the chart, and in the prompt the
 * risk officers and the portfolio manager read. Ten of the thirteen stored runs
 * are flat, so that was the common report, not the rare one.
 *
 * Every assertion below is written so a CORRECT implementation satisfies it and
 * the pre-fix behaviour fails it. The negative assertions carry as much weight
 * as the positive ones: naming a level correctly and ALSO still emitting the old
 * name would leave the contradiction on the page.
 *
 * BP-030 note, and it is the load-bearing one: a record written before FIX-780
 * has no `reassessBelowPrice` / `invalidateAbovePrice` KEYS at all. That is a
 * different input from an explicit `null`, and only the missing-key shape
 * reproduces a `=== null` guard bug. The legacy cases below use object literals
 * that genuinely omit the keys, and one test pins that both shapes read alike.
 */
import { describe, expect, it } from "vitest";
import {
  buildTradeLevelModel,
  LEGACY_LEVELS_CAPTION,
  levelsForStance,
  PRE_FLAT_STANCE_LABELING_FIX_REASON,
  tradeLevelChips,
  tradeLevelMetricEntries,
  tradeLineParts,
  withDerivedLevelMetrics,
  withDisplayLevelMetrics,
  type StoredTradeLevels,
} from "../flows/analysis/lib/trade-levels";
import {
  formatMemoBlock,
  formatTradeProposalExtensions,
} from "../flows/analysis/lib/format";
import { memoStateSchema } from "../flows/analysis/resources";
import type { TradeLevels } from "../components/summary/aggregate";

/**
 * Build a memo the way the system actually stores one — THROUGH the schema.
 *
 * The stance-less test below used to pass an object literal that simply omitted
 * `direction`, and that shape is unreachable: `memoStateSchema` declares
 * `direction` as `.nullable().default(null)`, so every parsed or persisted memo
 * carries `direction: null`, never `undefined`. A fixture composed alongside the
 * artifact instead of derived from it let a guard written against `undefined`
 * pass a test while being false for every real memo.
 *
 * Deriving the fixture from the schema is what makes the pass condition trace to
 * the stored shape rather than to the test author's memory of it (BP-030).
 */
function persistedMemo(fields: Record<string, unknown>) {
  return memoStateSchema.parse({
    status: "published",
    agentName: "fundamentals",
    agentTeam: "analyst",
    ticker: "NVDA",
    date: "2026-08-12",
    phaseId: "p1",
    ...fields,
  });
}

/** The MRVL-shaped flat report from the issue: a post-fix record. */
const FLAT_POST_FIX: StoredTradeLevels = {
  direction: "flat",
  stopPrice: null,
  targetPrice: null,
  reassessBelowPrice: 195,
  invalidateAbovePrice: 320,
};

/**
 * The same run as it is actually STORED today — the pre-fix shape. The two
 * monitoring keys are absent, not null: this literal is the legacy record, and
 * writing it any other way would test a shape the corpus does not contain.
 */
const FLAT_PRE_FIX = {
  direction: "flat",
  stopPrice: 320,
  targetPrice: 195,
} satisfies StoredTradeLevels;

const DIRECTIONAL: StoredTradeLevels = {
  direction: "long",
  stopPrice: 132,
  targetPrice: 185,
  reassessBelowPrice: null,
  invalidateAbovePrice: null,
};

describe("buildTradeLevelModel — the one rule every surface names levels by", () => {
  it("names a flat run's levels as monitoring levels, and never as a stop or a target", () => {
    const model = buildTradeLevelModel(FLAT_POST_FIX);
    expect(model.rows).toEqual([
      { kind: "monitoring", label: "reassess below", value: 195 },
      { kind: "monitoring", label: "invalidate above", value: 320 },
    ]);
    // The pre-fix behaviour is exactly this pair carrying trade names. A
    // renderer that still emitted either word on a flat call would re-create the
    // "stop above target on a Hold" line this issue exists to remove.
    const names = model.rows.map((r) => r.label);
    expect(names).not.toContain("stop");
    expect(names).not.toContain("target");
    expect(model.predatesLabelingFix).toBe(false);
  });

  it("shows a lone monitoring level on its own rather than inventing its partner", () => {
    const model = buildTradeLevelModel({
      direction: "flat",
      stopPrice: null,
      targetPrice: null,
      reassessBelowPrice: 195,
      invalidateAbovePrice: null,
    });
    // Two rows here would mean a number was fabricated to complete the range.
    expect(model.rows).toEqual([
      { kind: "monitoring", label: "reassess below", value: 195 },
    ]);
    expect(model.predatesLabelingFix).toBe(false);
  });

  it("shows nothing at all when a flat run produced neither pair", () => {
    const model = buildTradeLevelModel({
      direction: "flat",
      stopPrice: null,
      targetPrice: null,
      reassessBelowPrice: null,
      invalidateAbovePrice: null,
    });
    // Showing less is the deliberate price of decision 4: a non-compliant run
    // shows no levels rather than a range assembled from whatever it emitted.
    expect(model.rows).toEqual([]);
    expect(model.predatesLabelingFix).toBe(false);
  });

  it("shows a pre-fix flat record's numbers unlabeled and marked, never re-read as monitoring levels", () => {
    const model = buildTradeLevelModel(FLAT_PRE_FIX);
    expect(model.predatesLabelingFix).toBe(true);
    // Ascending, and unnamed. Nothing in the old record says which number was
    // the "look again" level and which was the "we were wrong" level, so any
    // name — including the correct-sounding new ones — would be a guess
    // presented as a stored fact.
    expect(model.rows).toEqual([
      { kind: "legacy", label: "", value: 195 },
      { kind: "legacy", label: "", value: 320 },
    ]);
    // Specifically NOT mapped onto the new names by position: the stored
    // `stopPrice` was 320 and `targetPrice` 195, so a positional re-read would
    // name 320 "reassess below" — the exact inversion that made the old report
    // nonsense in the first place.
    expect(model.rows.map((r) => r.label)).toEqual(["", ""]);
  });

  it("reads a missing monitoring key and an explicit null as the same absence", () => {
    // The corpus stores the missing-key shape; a `=== null` guard would treat
    // the two differently and fall through to the wrong branch on real data.
    const explicitNulls = buildTradeLevelModel({
      direction: "flat",
      stopPrice: 320,
      targetPrice: 195,
      reassessBelowPrice: null,
      invalidateAbovePrice: null,
    });
    expect(explicitNulls).toEqual(buildTradeLevelModel(FLAT_PRE_FIX));
    expect(explicitNulls.predatesLabelingFix).toBe(true);
  });

  it("collapses a flat record whose two levels sit at the same price into one row", () => {
    // One decision line, not a range — there is nothing to straddle.
    expect(
      buildTradeLevelModel({
        direction: "flat",
        stopPrice: null,
        targetPrice: null,
        reassessBelowPrice: 200,
        invalidateAbovePrice: 200,
      }).rows,
    ).toEqual([
      {
        kind: "monitoring",
        label: "reassess below / invalidate above",
        value: 200,
      },
    ]);
    expect(buildTradeLevelModel({ direction: "flat", stopPrice: 200, targetPrice: 200 }).rows)
      .toEqual([{ kind: "legacy", label: "", value: 200 }]);
  });

  it("leaves a directional record exactly as it read before this change", () => {
    const model = buildTradeLevelModel(DIRECTIONAL);
    expect(model.rows).toEqual([
      { kind: "stop", label: "stop", value: 132 },
      { kind: "target", label: "target", value: 185 },
    ]);
    expect(model.predatesLabelingFix).toBe(false);
    // A legacy DIRECTIONAL record (no monitoring keys) is indistinguishable
    // from a new one — it was never mislabeled, so it must not acquire a marker.
    const legacyDirectional = buildTradeLevelModel({
      direction: "long",
      stopPrice: 132,
      targetPrice: 185,
    });
    expect(legacyDirectional).toEqual(model);
  });

  it("ignores monitoring levels on a directional record rather than showing them", () => {
    // The read-side mirror of the commit gate: a level that does not match the
    // stance is not shown under a name the stance cannot carry.
    expect(
      buildTradeLevelModel({
        direction: "long",
        stopPrice: 132,
        targetPrice: 185,
        reassessBelowPrice: 100,
        invalidateAbovePrice: 300,
      }).rows.map((r) => r.value),
    ).toEqual([132, 185]);
  });

  it("shows nothing for a run that never reached the trader", () => {
    expect(buildTradeLevelModel({ direction: null }).rows).toEqual([]);
  });
});

describe("levelsForStance — the commit gate that makes the stance binding", () => {
  it("stores a flat run's monitoring pair and no stop or target", () => {
    expect(
      levelsForStance("flat", {
        stopPrice: null,
        targetPrice: null,
        reassessBelowPrice: 195,
        invalidateAbovePrice: 320,
      }),
    ).toEqual({
      stopPrice: null,
      targetPrice: null,
      reassessBelowPrice: 195,
      invalidateAbovePrice: 320,
    });
  });

  it("stores a directional run's trade pair and no monitoring levels", () => {
    expect(
      levelsForStance("long", {
        stopPrice: 132,
        targetPrice: 185,
        reassessBelowPrice: 100,
        invalidateAbovePrice: 300,
      }),
    ).toEqual({
      stopPrice: 132,
      targetPrice: 185,
      reassessBelowPrice: null,
      invalidateAbovePrice: null,
    });
  });

  it("drops a flat run's wrongly-filed levels instead of re-filing them under the monitoring names", () => {
    // This is the whole of decision 4. Re-filing 320 as "invalidate above"
    // would look like the feature working while asserting an intent the model
    // never expressed — the same dishonesty one layer down.
    expect(
      levelsForStance("flat", { stopPrice: 320, targetPrice: 195 }),
    ).toEqual({
      stopPrice: null,
      targetPrice: null,
      reassessBelowPrice: null,
      invalidateAbovePrice: null,
    });
  });
});

describe("tradeLevelMetricEntries — the memo's display metrics row", () => {
  it("keys a flat run's metrics row by the monitoring names", () => {
    // The metrics row is rendered `key=value` straight into the risk and PM
    // prompt block, so `stop=$320` there is the same defect as on the screen.
    expect(tradeLevelMetricEntries(FLAT_POST_FIX)).toEqual({
      "reassess below": "$195",
      "invalidate above": "$320",
    });
  });

  it("keys a directional run's metrics row by stop and target", () => {
    expect(tradeLevelMetricEntries(DIRECTIONAL)).toEqual({
      stop: "$132",
      target: "$185",
    });
  });
});

describe("withDerivedLevelMetrics — the stored metrics map is not exempt", () => {
  // The `metrics` map is free-form `Record<string, string>`, so it is a SECOND
  // copy of the level names that no schema constrains — and it is rendered
  // `key=value` into the prompt AND as the PM hero's chip labels. These tests
  // pin that it is re-derived from the typed fields wherever it is read.

  it("strips a legacy flat record's stop and target rather than passing them on", () => {
    // The defect: a resumed pre-fix session handed the risk officers
    // `stop=$320, target=$195` — the exact mislabeled pair — and, two lines
    // later, a note saying the desk cannot tell which level is which.
    expect(
      withDerivedLevelMetrics(FLAT_PRE_FIX, {
        rating: "Hold",
        size: "0%",
        stop: "$320",
        target: "$195",
      }),
    ).toEqual({ rating: "Hold", size: "0%" });
  });

  it("replaces a flat record's level keys with the monitoring pair", () => {
    expect(
      withDerivedLevelMetrics(FLAT_POST_FIX, {
        rating: "Hold",
        stop: "$320",
        target: "$195",
      }),
    ).toEqual({
      rating: "Hold",
      "reassess below": "$195",
      "invalidate above": "$320",
    });
  });

  it("leaves a directional record's stop and target, sourced from the typed fields", () => {
    // Same keys as the model would have emitted, but they now trace to
    // `stopPrice` / `targetPrice` rather than to a string the model wrote.
    expect(
      withDerivedLevelMetrics(DIRECTIONAL, {
        rating: "Buy",
        stop: "$1",
        target: "$2",
      }),
    ).toEqual({ rating: "Buy", stop: "$132", target: "$185" });
  });

  it("keeps the level chips where they sat, so a post-fix prompt block is unchanged", () => {
    // Position matters only to avoid unrelated churn in prompts the risk
    // officers read: the derived pair lands where the first level key was.
    expect(
      Object.keys(
        withDerivedLevelMetrics(DIRECTIONAL, {
          direction: "long",
          size: "1.4%",
          stop: "$1",
          target: "$2",
          conviction: "0.7",
        }),
      ),
    ).toEqual(["direction", "size", "stop", "target", "conviction"]);
  });

  it("adds the levels when the stored map never had a level key", () => {
    expect(withDerivedLevelMetrics(FLAT_POST_FIX, { rating: "Hold" })).toEqual({
      rating: "Hold",
      "reassess below": "$195",
      "invalidate above": "$320",
    });
  });
});

describe("tradeLevelChips — the PM hero's level chips on a REOPENED report", () => {
  // The read path. `withDerivedLevelMetrics` corrects the PM's stored metrics at
  // COMMIT, and opening a historical report never runs a commit — so the hero
  // used to render whatever keys the persisted map carried. On a pre-FIX-780
  // flat record those keys are `stop` and `target`, which is a fabricated
  // stop-loss on a stand-aside call, shown on the decision surface a user reads.

  it("captions a legacy flat record's numbers instead of naming either one", () => {
    expect(tradeLevelChips(buildTradeLevelModel(FLAT_PRE_FIX))).toEqual([
      { key: "__legacy_levels__", label: LEGACY_LEVELS_CAPTION, value: "$195, $320" },
    ]);
  });

  it("never labels a legacy flat record's chip stop or target", () => {
    // The whole point: the numbers survive, their false identities do not.
    const labels = tradeLevelChips(buildTradeLevelModel(FLAT_PRE_FIX)).map(
      (c) => c.label,
    );
    expect(labels).not.toContain("stop");
    expect(labels).not.toContain("target");
  });

  it("gives a post-fix flat record the monitoring pair", () => {
    expect(tradeLevelChips(buildTradeLevelModel(FLAT_POST_FIX))).toEqual([
      { key: "reassess below", label: "reassess below", value: "$195" },
      { key: "invalidate above", label: "invalidate above", value: "$320" },
    ]);
  });

  it("keeps a directional record's real stop and target", () => {
    // The case a naive shape test would have broken: a PM record carrying
    // `stop` / `target` is NOT automatically legacy — a post-fix directional
    // decision carries exactly those two keys, correctly. Only the trader's
    // stance separates this record from the legacy flat one above.
    expect(tradeLevelChips(buildTradeLevelModel(DIRECTIONAL))).toEqual([
      { key: "stop", label: "stop", value: "$132" },
      { key: "target", label: "target", value: "$185" },
    ]);
  });

  it("shows no level chips when the trader memo is unreadable", () => {
    // A run that never reached Phase 3, or a still-loading resource. Nothing is
    // shown rather than a fabricated range (spec §6 decision 4).
    expect(tradeLevelChips(null)).toEqual([]);
  });
});

describe("withDisplayLevelMetrics — a memo doc opened from a HISTORICAL report", () => {
  // The fifth surface. The trader memo renders through the generic
  // ThesisHeader/ThesisMetrics chip grid, and the pre-FIX-780 trader schema
  // required `{direction, size, stop, target, conviction}` on EVERY stance — so
  // reopening a stand-aside report and clicking the trader memo showed
  // `stop $320 / target $195`. There is no commit on that path to correct it.

  it("captions a legacy flat trader row instead of showing stop and target", () => {
    const out = withDisplayLevelMetrics(FLAT_PRE_FIX, {
      direction: "flat",
      size: "0%",
      stop: "$320",
      target: "$195",
      conviction: "0.6",
    });
    expect(out).toEqual({
      direction: "flat",
      size: "0%",
      [LEGACY_LEVELS_CAPTION]: "$195, $320",
      conviction: "0.6",
    });
    // The numbers survive; their false identities do not.
    expect(Object.keys(out)).not.toContain("stop");
    expect(Object.keys(out)).not.toContain("target");
  });

  it("differs from the prompt path deliberately: the prompt drops, the doc captions", () => {
    // `withDerivedLevelMetrics` drops a legacy pair because the prompt discloses
    // it separately with its reason. A chip grid has no second line, so dropping
    // would silently lose real measurements. Same record, two justified answers.
    const stored = { rating: "Hold", stop: "$320", target: "$195" };
    expect(withDerivedLevelMetrics(FLAT_PRE_FIX, stored)).toEqual({
      rating: "Hold",
    });
    expect(withDisplayLevelMetrics(FLAT_PRE_FIX, stored)).toEqual({
      rating: "Hold",
      [LEGACY_LEVELS_CAPTION]: "$195, $320",
    });
  });

  it("renames a post-fix flat trader row to the monitoring pair", () => {
    expect(
      withDisplayLevelMetrics(FLAT_POST_FIX, {
        direction: "flat",
        stop: "$320",
        target: "$195",
      }),
    ).toEqual({
      direction: "flat",
      "reassess below": "$195",
      "invalidate above": "$320",
    });
  });

  it("leaves a directional row's real stop and target in place", () => {
    expect(
      withDisplayLevelMetrics(DIRECTIONAL, {
        direction: "long",
        stop: "$1",
        target: "$2",
      }),
    ).toEqual({ direction: "long", stop: "$132", target: "$185" });
  });

  it("does not re-caption an already-captioned row on a second read", () => {
    // The read path can run over its own output (a re-render). The caption key
    // is a level key for this rule's purposes, so it is replaced, not appended.
    const once = withDisplayLevelMetrics(FLAT_PRE_FIX, {
      rating: "Hold",
      stop: "$320",
      target: "$195",
    });
    expect(withDisplayLevelMetrics(FLAT_PRE_FIX, once)).toEqual(once);
  });
});

describe("formatMemoBlock — the composition seam every memo's metrics pass through", () => {
  it("does not hand a resumed pre-fix proposal a stop and a target", () => {
    // The `tradeProposal` capability composes this block ABOVE the corrected
    // extension block, so leaving it alone made the prompt contradict itself
    // two lines apart — the exact failure this PR's own description predicted
    // for the trader's row and closed only for the new path.
    const out = formatMemoBlock("Trade proposal", {
      headline: "Stand aside on NVDA.",
      rating: "flat",
      metrics: { direction: "flat", size: "0%", stop: "$320", target: "$195" },
      ...FLAT_PRE_FIX,
    });
    expect(out).not.toContain("stop=");
    expect(out).not.toContain("target=");
    expect(out).toContain("direction=flat");
    expect(out).toContain("size=0%");
  });

  it("renames a post-fix flat memo's level chips to the monitoring pair", () => {
    const out = formatMemoBlock("Trade proposal", {
      headline: "Stand aside on NVDA.",
      rating: "flat",
      metrics: { direction: "flat", size: "0%", stop: "$320", target: "$195" },
      ...FLAT_POST_FIX,
    });
    expect(out).toContain("reassess below=$195");
    expect(out).toContain("invalidate above=$320");
    expect(out).not.toContain("stop=");
  });

  it("leaves a stance-less memo's metrics completely alone", () => {
    // Phase 1 analysts and the lenses record no stance, so nothing in their
    // metrics is a level name — this rule must not touch them.
    //
    // Built through `memoStateSchema` deliberately: a stance-less memo is
    // `direction: null`, NOT a memo missing the key. The earlier literal omitted
    // `direction` entirely, which no parse and no store ever produces, and that
    // is precisely why this test passed while the guard was false for every real
    // analyst, lens, and research memo.
    const out = formatMemoBlock(
      "Fundamentals",
      persistedMemo({
        headline: "Margins compressed.",
        rating: "Underweight",
        metrics: { conviction: "0.7", horizon: "6mo", target: "$185" },
      }),
    );
    expect(out).toContain("target=$185");
    expect(out).toContain("conviction=0.7");
  });

  it("keeps a bull thesis's quantitative price case intact", () => {
    // `bullThesisOutputSchema` REQUIRES `metrics.target` and `metrics.stop`
    // (agents/research/generators.ts), and `commitBullMemo` spreads the thesis
    // straight onto the memo — so the bull memo is a stance-less memo whose
    // metrics legitimately carry two level-named keys. Stripping them discards
    // the bull case's entire quantitative argument before the risk officers and
    // the PM ever read it.
    const out = formatMemoBlock(
      "Bull thesis",
      persistedMemo({
        agentName: "bull",
        agentTeam: "research",
        phaseId: "p2",
        headline: "Accelerating datacenter demand.",
        rating: "buy",
        metrics: {
          conviction: "0.8",
          horizon: "6mo",
          target: "$240",
          stop: "$160",
        },
      }),
    );
    expect(out).toContain("target=$240");
    expect(out).toContain("stop=$160");
  });
});

describe("formatTradeProposalExtensions — what the risk officers and the PM read", () => {
  it("gives a flat proposal monitoring levels, and no stop or target line", () => {
    const out = formatTradeProposalExtensions({
      ...FLAT_POST_FIX,
      sizePct: 0,
      holdingPeriod: "months",
    });
    expect(out).toContain("Reassess below: $195");
    expect(out).toContain("Invalidate above: $320");
    // The half of the bug that changes the desk's own reasoning: the risk
    // personas and the PM were being told a flat call had a stop at $320.
    expect(out).not.toContain("Stop:");
    expect(out).not.toContain("Target:");
  });

  it("leaves a directional proposal's lines unchanged", () => {
    const out = formatTradeProposalExtensions({
      ...DIRECTIONAL,
      sizePct: 1.4,
      holdingPeriod: "months",
    });
    expect(out).toContain("Stop: $132");
    expect(out).toContain("Target: $185");
    expect(out).not.toContain("Reassess below");
    expect(out).not.toContain("Invalidate above");
  });

  it("passes a resumed pre-fix proposal's numbers through unnamed, with the reason", () => {
    // Reachable when a session written before FIX-780 is resumed and re-runs a
    // later phase against its stored trader memo.
    const out = formatTradeProposalExtensions({
      ...FLAT_PRE_FIX,
      sizePct: 0,
    });
    expect(out).toContain("Levels recorded: $195, $320");
    expect(out).toContain(PRE_FLAT_STANCE_LABELING_FIX_REASON);
    expect(out).not.toContain("Stop:");
  });

  it("tells the model the same thing about these levels that it tells the user", () => {
    // The prompt and the screen are two renderings of ONE disclosure. When they
    // were worded independently the desk could drift into telling the model the
    // two numbers are unidentifiable while the report told the reader something
    // else about the same record — an inconsistency that spans prompt and
    // screen, which is worse than either wording being wrong alone. Both now
    // read the shared caption + reason from `lib/trade-levels.ts`.
    const out = formatTradeProposalExtensions({ ...FLAT_PRE_FIX, sizePct: 0 });

    // The user-facing disclosure, verbatim — not a paraphrase of it.
    expect(out).toContain(PRE_FLAT_STANCE_LABELING_FIX_REASON);
    // The caption word is the screen's, differing only in this surface's casing.
    expect(out.toLowerCase()).toContain(`${LEGACY_LEVELS_CAPTION}:`);
    // The one part that is prompt-only: the model is told what NOT to do with
    // them. A reader of the report needs the fact; the model needs the rule.
    expect(out).toContain("Do not read them as a stop and a target.");
  });
});

describe("the decision one-liner", () => {
  /** A `TradeLevels` slice with the level fields overridden. */
  function tradeLevels(overrides: Partial<NonNullable<TradeLevels>>) {
    return {
      direction: "flat" as const,
      sizePct: 0,
      stopPrice: null,
      targetPrice: null,
      reassessBelowPrice: null,
      invalidateAbovePrice: null,
      holdingPeriod: "months" as const,
      invalidationCriteria: null,
      ...overrides,
    };
  }

  it("reads as a flat call with monitoring levels, not as a short trade", () => {
    const trade = tradeLevels({ reassessBelowPrice: 195, invalidateAbovePrice: 320 });
    expect(tradeLineParts(trade, buildTradeLevelModel(trade)).join(" · ")).toBe(
      "FLAT · 0% NAV · reassess below 195 · invalidate above 320 · months",
    );
  });

  it("captions a pre-fix report's two numbers instead of naming either", () => {
    const trade = tradeLevels({ stopPrice: 320, targetPrice: 195 });
    expect(tradeLineParts(trade, buildTradeLevelModel(trade)).join(" · ")).toBe(
      "FLAT · 0% NAV · levels recorded: 195, 320 · months",
    );
  });

  it("carries no 'predates a fix' text of its own — that is the shared notice's", () => {
    // The report shows exactly ONE such marker (`ReportProvenanceNotice`,
    // FIX-1063), which takes a list of reasons so a later fix adds an entry
    // rather than a second banner. A second one here would stack chrome on
    // precisely the reports a reader already has least reason to trust.
    const trade = tradeLevels({ stopPrice: 320, targetPrice: 195 });
    const line = tradeLineParts(trade, buildTradeLevelModel(trade)).join(" · ");
    expect(line).not.toMatch(/predates|fix/i);
    // The disclosure exists — as a reason string for that one notice, gated on
    // the flag this rule derives.
    expect(buildTradeLevelModel(trade).predatesLabelingFix).toBe(true);
    expect(PRE_FLAT_STANCE_LABELING_FIX_REASON).toMatch(/reassess|invalidate/);
  });

  it("leaves a directional one-liner unchanged", () => {
    const trade = tradeLevels({
      direction: "long",
      sizePct: 1.4,
      stopPrice: 132,
      targetPrice: 185,
    });
    expect(tradeLineParts(trade, buildTradeLevelModel(trade)).join(" · ")).toBe(
      "LONG · 1.4% NAV · stop 132 · target 185 · months",
    );
  });
});
