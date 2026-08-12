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
  tradeLevelMetricEntries,
  tradeLineParts,
  type StoredTradeLevels,
} from "../flows/analysis/lib/trade-levels";
import { formatTradeProposalExtensions } from "../flows/analysis/lib/format";
import type { TradeLevels } from "../components/summary/aggregate";

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
