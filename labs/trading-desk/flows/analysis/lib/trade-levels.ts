/**
 * The ONE rule that decides what a stored decision's price levels are called
 * (FIX-780), and the stance gate that decides which of them a run may store.
 *
 * A directional call records a **stop** and a **target**. A flat call — the desk
 * deciding not to take a position — records the level below which it would
 * reconsider and the level above which standing aside is proven wrong, and
 * records no stop and no target, because there is no position to stop out of.
 * Before this rule existed a flat run wrote its two monitoring levels into
 * `stopPrice` / `targetPrice`, so a "Hold, no position" report also read
 * "stop $320 / target $195" — a short setup with the stop above the target.
 *
 * Two exported rules, deliberately in one file because they are two halves of
 * the same knowledge (which pair belongs to which stance):
 *
 *  - {@link levelsForStance} — the WRITE half. Applied in the trader's commit
 *    handler: the stance decides which pair survives, so a non-compliant run
 *    loses the numbers it filled in rather than storing them under names they
 *    were not written as (spec §6 decision 4).
 *  - {@link buildTradeLevelModel} — the READ half. Every surface that shows a
 *    level reads it: the Summary's levels list, the price-overlay legend, the
 *    decision one-liner, and the trade-proposal prompt block the risk officers
 *    and the PM reason over (spec §6 decision 2). A fifth surface must read it
 *    too rather than spell the labels a third way.
 *
 * Pure and dependency-free by design — it is imported from both the server-side
 * flow (`lib/format.ts`, the trader writer) and the client bundle
 * (`components/summary/*`), the `lib/rating-engine` precedent. No React, no zod,
 * no `@flow-state-dev/core`.
 *
 * BP-030: records written before FIX-780 carry no monitoring keys at all, so
 * every level input is read as `number | null | undefined` and tested with
 * `== null`. A missing key and an explicit null are the same absence here.
 */

/** The stance a stored decision recorded. Null on a run that never reached the
 *  trader (stopped / in-progress), where nothing is shown at all. */
export type TradeStance = "long" | "short" | "flat" | null;

/**
 * The four stored level fields plus the stance that says which pair is real.
 *
 * The level fields are optional AND nullable: a decision record written before
 * FIX-780 has no `reassessBelowPrice` / `invalidateAbovePrice` keys, so reads
 * see `undefined` rather than `null` (BP-030 — the missing-key shape is the
 * legacy shape, and it is the majority of the stored corpus).
 */
export type StoredTradeLevels = {
  direction: TradeStance;
  /** Directional only: the price that triggers a stop-loss. */
  stopPrice?: number | null;
  /** Directional only: the price that triggers a take-profit. */
  targetPrice?: number | null;
  /** Flat only: below this, the name is worth another look. */
  reassessBelowPrice?: number | null;
  /** Flat only: above this, standing aside was wrong. */
  invalidateAbovePrice?: number | null;
};

/** What kind of level a row is. Consumers map this to presentation (the chart
 *  picks a colour off it); the *name* is always {@link TradeLevelRow.label}, so
 *  no surface invents its own spelling. */
export type TradeLevelKind = "stop" | "target" | "monitoring" | "legacy";

/** One level to show, already named. */
export type TradeLevelRow = {
  kind: TradeLevelKind;
  /**
   * What every surface calls this level. Canonical lower-case; a surface with a
   * different house style (the prompt block capitalises its field names) may
   * re-case it, but must not rename it.
   *
   * Empty string for `kind: "legacy"` — a pre-FIX-780 flat record does not
   * record which of its two numbers was which, and naming one would be a guess
   * presented as a record (spec §6 decision 3).
   */
  label: string;
  value: number;
};

/** The named levels to show for one stored decision. */
export type TradeLevelModel = {
  /** The levels to show, in display order. Empty when the record has none —
   *  surfaces show nothing rather than a fabricated range (spec §6 decision 4). */
  rows: TradeLevelRow[];
  /**
   * True for a flat record written before FIX-780: it carries trade levels and
   * no monitoring levels, so its two numbers are shown unlabeled. Detection is
   * data-shape-based and needs no version stamp.
   *
   * This flag does NOT render anything itself. It is the input to the report's
   * ONE shared provenance notice — see {@link PRE_FLAT_STANCE_LABELING_FIX_REASON}.
   */
  predatesLabelingFix: boolean;
};

// The canonical names of a flat run's two monitoring levels. Deliberately NOT
// exported: a consumer reads the name off the row it is rendering, so there is
// no call site that needs to say the word itself. That is the guarantee.
const REASSESS_BELOW_LABEL = "reassess below";
const INVALIDATE_ABOVE_LABEL = "invalidate above";

/**
 * What a pre-FIX-780 record's levels are called COLLECTIVELY. There is no name
 * for either one — the caption names the pair, which is all the record supports.
 */
export const LEGACY_LEVELS_CAPTION = "levels recorded";

/**
 * What a reader is told about a pre-FIX-780 record's levels — ONE ENTRY in the
 * report's shared provenance-notice reason list, never a marker of its own.
 *
 * `ReportProvenanceNotice` (FIX-1063, `components/summary/`) is the single
 * report-level "this predates a fix" banner, and it was built to carry exactly
 * this case: it takes a list of reasons so a later fix adds an entry rather
 * than a second banner. Two stacked markers read worse to a user than either
 * alone, and they stack on precisely the reports a reader already has least
 * reason to trust. So nothing in this change renders a notice — it produces
 * `predatesLabelingFix` and this string, and the report surface appends it.
 *
 * Phrased as a statement about the report, matching `PRE_DATA_HONESTY_FIX_REASON`.
 */
export const PRE_FLAT_STANCE_LABELING_FIX_REASON =
  "A stand-aside call's two price levels are recorded without saying which is the reassess level and which is the invalidate level.";

/** Read a stored level, treating a missing key and an explicit null alike
 *  (BP-030). A non-finite stored number is absence too — never a drawable 0. */
function level(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Collapse rows that sit at the same price into one row, joining their names.
 *
 * A flat record whose two monitoring levels are equal describes one decision
 * line, not a range — there is nothing to straddle, so it reads as one row
 * (spec §9). Applied only to the flat branches: a directional record's stop and
 * target render as two rows exactly as they did before FIX-780, even in the
 * degenerate case where they coincide.
 */
function collapseEqual(rows: TradeLevelRow[]): TradeLevelRow[] {
  const collapsed: TradeLevelRow[] = [];
  for (const row of rows) {
    const existing = collapsed.find((r) => r.value === row.value);
    if (existing === undefined) {
      collapsed.push({ ...row });
      continue;
    }
    // Join the two names rather than dropping one — the record says both apply
    // at this price, and picking one would be an interpretation.
    existing.label =
      existing.label === "" || row.label === ""
        ? existing.label || row.label
        : `${existing.label} / ${row.label}`;
  }
  return collapsed;
}

/**
 * The READ half: name the levels one stored decision should show.
 *
 * Three cases, in the order they are decided:
 *
 *  1. **Flat with monitoring levels** — the post-fix flat record. Shows the one
 *     or two it has, labeled. A missing partner is left missing; nothing is
 *     inferred from the one that is present.
 *  2. **Flat with only trade levels** — the pre-fix record (`predatesLabelingFix`).
 *     Shows the numbers unlabeled, in ascending order: presenting them in their
 *     stored `stop, target` order would leak the old field identity by position,
 *     which is the same guess-as-record the labels themselves refuse to make.
 *  3. **Anything else** — the directional path, unchanged from before FIX-780.
 *     Monitoring levels on a directional record are ignored rather than shown
 *     under a name the stance cannot carry (the read-side mirror of
 *     {@link levelsForStance}).
 *
 * A flat record carrying BOTH pairs is read as case 1: it has stance-correct
 * levels, so the trade pair is the part that does not belong.
 */
export function buildTradeLevelModel(
  stored: StoredTradeLevels,
): TradeLevelModel {
  const stop = level(stored.stopPrice);
  const target = level(stored.targetPrice);
  const reassess = level(stored.reassessBelowPrice);
  const invalidate = level(stored.invalidateAbovePrice);

  if (stored.direction === "flat") {
    if (reassess !== null || invalidate !== null) {
      const rows: TradeLevelRow[] = [];
      if (reassess !== null)
        rows.push({
          kind: "monitoring",
          label: REASSESS_BELOW_LABEL,
          value: reassess,
        });
      if (invalidate !== null)
        rows.push({
          kind: "monitoring",
          label: INVALIDATE_ABOVE_LABEL,
          value: invalidate,
        });
      return { rows: collapseEqual(rows), predatesLabelingFix: false };
    }

    if (stop !== null || target !== null) {
      const values = [stop, target]
        .filter((v): v is number => v !== null)
        .sort((a, b) => a - b);
      return {
        rows: collapseEqual(
          values.map((value) => ({ kind: "legacy" as const, label: "", value })),
        ),
        predatesLabelingFix: true,
      };
    }

    return { rows: [], predatesLabelingFix: false };
  }

  const rows: TradeLevelRow[] = [];
  if (stop !== null) rows.push({ kind: "stop", label: "stop", value: stop });
  if (target !== null)
    rows.push({ kind: "target", label: "target", value: target });
  return { rows, predatesLabelingFix: false };
}

/**
 * The level entries of the trader memo's display `metrics` row, derived from the
 * typed level fields through {@link buildTradeLevelModel} rather than taken from
 * the model's own metric strings.
 *
 * The `metrics` row is rendered as `key=value` pairs into the trade-proposal
 * prompt block that the risk officers and the PM read, so its KEYS are level
 * names and fall under the same one-rule guarantee as every other surface. They
 * are derived at commit for the same reason the stance gate is: a flat run that
 * writes `stop=$320` in its metrics row contradicts its own typed fields, and
 * the desk can determine which name is right without asking.
 *
 * Rows with no name (a pre-FIX-780 legacy record) contribute no entry — a
 * `key=value` row cannot show an unlabeled number without inventing a key.
 * Unreachable at commit, where the record being written is post-fix by
 * construction.
 */
export function tradeLevelMetricEntries(
  stored: StoredTradeLevels,
): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const row of buildTradeLevelModel(stored).rows) {
    if (row.label === "") continue;
    entries[row.label] = `$${row.value}`;
  }
  return entries;
}

/** The four level fields as they are stored on a memo, snapshot, or run
 *  summary — the output of {@link levelsForStance}. Every field is explicit, so
 *  spreading this over a record clears the pair that does not belong. */
export type StanceGatedLevels = {
  stopPrice: number | null;
  targetPrice: number | null;
  reassessBelowPrice: number | null;
  invalidateAbovePrice: number | null;
};

/**
 * The WRITE half: keep only the pair of levels the stance can carry.
 *
 * The trader is told in its prompt which pair to produce; this is the desk
 * deciding what it can decide rather than trusting the answer (the
 * `agreesWithTrader` precedent). A flat run keeps the monitoring pair and stores
 * no stop and no target; any other stance does the reverse.
 *
 * A run that fills in the wrong pair LOSES those numbers (spec §6 decision 4):
 * the price is that an occasional non-compliant run shows no levels at all,
 * which is honest, where storing a stop on a position the desk did not take is
 * not. The numbers are never re-filed under the other pair's names — nothing in
 * the output says the model meant them that way.
 */
export function levelsForStance(
  stance: TradeStance,
  emitted: Omit<StoredTradeLevels, "direction">,
): StanceGatedLevels {
  if (stance === "flat") {
    return {
      stopPrice: null,
      targetPrice: null,
      reassessBelowPrice: level(emitted.reassessBelowPrice),
      invalidateAbovePrice: level(emitted.invalidateAbovePrice),
    };
  }
  return {
    stopPrice: level(emitted.stopPrice),
    targetPrice: level(emitted.targetPrice),
    reassessBelowPrice: null,
    invalidateAbovePrice: null,
  };
}
