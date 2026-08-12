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
 * Does this memo record a stance at all?
 *
 * The guard every caller needs before applying a level rule, and it must be
 * written POSITIVELY — "is one of the three stances" — never as an absence test.
 * `memoStateSchema` declares `direction` as `.nullable().default(null)`, so a
 * parsed or persisted memo that records no stance carries `null`, never
 * `undefined`. A guard spelled `direction === undefined` is therefore false for
 * every real memo, and silently runs the level rule over the analyst, lens, and
 * research memos, whose free-form `metrics` map legitimately contains keys named
 * `target` and `stop` (the bull thesis REQUIRES both — see
 * `agents/research/generators.ts`). Those entries are then dropped as stale
 * level copies, discarding the memo's quantitative case.
 *
 * Named here because this file is the single owner of what a stance is, and
 * because the absence-test form is the mistake this rule keeps inviting.
 */
export function hasTradeStance(
  direction: unknown,
): direction is Exclude<TradeStance, null> {
  return direction === "long" || direction === "short" || direction === "flat";
}

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
 * The ONE way a pre-FIX-780 record's unlabeled levels are captioned, as a single
 * segment: `levels recorded: 195, 320`.
 *
 * Both surfaces that show a legacy record read this — the decision one-liner and
 * the trade-proposal prompt block — so the screen and the desk's own prompt
 * cannot caption the same two numbers differently. Only `formatValue` varies
 * (the prompt writes `$195`, the screen writes `195`); the caption word and the
 * join are the shared part, which is the part that would otherwise drift.
 *
 * A surface with a different house style may re-case the result, the same
 * latitude {@link TradeLevelRow.label} grants — but must not re-word it.
 */
export function formatLegacyLevels(
  rows: readonly TradeLevelRow[],
  formatValue: (value: number) => string = String,
): string {
  return `${LEGACY_LEVELS_CAPTION}: ${rows.map((r) => formatValue(r.value)).join(", ")}`;
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

/**
 * Every metric key that NAMES a price level — the keys this rule owns.
 *
 * `stop` / `target` are here because they are what a pre-FIX-780 record's
 * `metrics` map persisted, and that stored map is a second, untyped copy of the
 * level names that no schema constrains.
 */
const LEVEL_METRIC_KEYS: ReadonlySet<string> = new Set([
  "stop",
  "target",
  REASSESS_BELOW_LABEL,
  INVALIDATE_ABOVE_LABEL,
]);

/**
 * Re-derive a stored `metrics` map's level entries from the typed levels.
 *
 * The display `metrics` map is free-form `Record<string, string>` — no schema
 * constrains its keys — so it is a SECOND copy of the level names sitting
 * outside {@link buildTradeLevelModel}'s reach. A record written before FIX-780
 * has `stop` / `target` frozen into it, and it is rendered `key=value` straight
 * into the prompt the risk officers and the PM read. Left alone, a resumed
 * pre-fix session hands them `stop=$320, target=$195` and, two lines later, a
 * note saying the desk cannot tell which level is which.
 *
 * So the map is not exempt from the one rule: the level keys are DROPPED and
 * replaced by what the typed fields actually support. A legacy flat record
 * supports no name for either number, so it contributes no entry at all and the
 * numbers are carried by the captioned line instead. Non-level keys
 * (`rating`, `size`, `conviction`, …) pass through untouched.
 *
 * Position is preserved: the derived entries land where the first level key sat,
 * so a post-fix record's prompt block reads exactly as it did before. Only a
 * record that was actually mislabeled changes.
 */
export function withDerivedLevelMetrics(
  stored: StoredTradeLevels,
  metrics: Record<string, string> | null | undefined,
): Record<string, string> {
  return replaceLevelKeys(metrics, tradeLevelMetricEntries(stored));
}

/**
 * Drop every level-named key from a stored metrics map and put `derived` where
 * the first one sat. Shared by the two derivations below so the placement rule
 * (and the "the rest are stale copies" rule) is written once.
 */
function replaceLevelKeys(
  metrics: Record<string, string> | null | undefined,
  derived: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  let placed = false;
  for (const [key, value] of Object.entries(metrics ?? {})) {
    if (!LEVEL_METRIC_KEYS.has(key) && key !== LEGACY_LEVELS_CAPTION) {
      out[key] = value;
      continue;
    }
    // The first level key is where the derived pair goes; the rest are the
    // stale copies this rule exists to remove.
    if (!placed) {
      placed = true;
      Object.assign(out, derived);
    }
  }
  if (!placed) Object.assign(out, derived);
  return out;
}

/**
 * Strip every level-named key and put nothing back — for a participant whose
 * memo has no business carrying price levels at all.
 *
 * The portfolio manager is that participant. Its levels were only ever the
 * TRADER's, copied in for display, and the desk supports the two disagreeing —
 * so a PM Hold's metrics could carry a stop and a target, and a PM Buy's could
 * carry monitoring levels. Attributing that at each consumer (the hero renders
 * them under a "trader proposal" label) works only where there is a surface to
 * label; a formatter that serializes the whole memo — `formatMemoBlock`, which
 * feeds the Phase 6 thesis auditor a block headed "Portfolio decision" — has
 * nowhere to put the attribution, and neither will the next consumer.
 *
 * So the levels leave the data instead. The PM memo carries the PM's decision;
 * anything that wants the trader's levels reads the trader memo, which is what
 * every corrected surface now does.
 *
 * Also removes the stale pair from a pre-FIX-780 PM record, whose old schema
 * REQUIRED `metrics.stop` / `metrics.target` on every stance.
 */
export function withoutLevelMetrics(
  metrics: Record<string, string> | null | undefined,
): Record<string, string> {
  return replaceLevelKeys(metrics, {});
}

/**
 * The metrics map a RENDERED memo doc shows — the read-path twin of
 * {@link withDerivedLevelMetrics}.
 *
 * Same correction, one deliberate difference: a legacy record's two numbers are
 * kept under the shared caption rather than dropped. The prompt path drops them
 * because {@link formatTradeProposalExtensions} discloses the pair separately,
 * with its reason, a line below; a chip grid has no such second line, so
 * dropping them here would silently discard measurements the desk really took.
 *
 * Needed because a memo doc opened from a HISTORICAL report never runs a commit,
 * so the stored map is whatever the run wrote — and a pre-FIX-780 trader record
 * wrote `stop` / `target` on every stance, flat included.
 */
export function withDisplayLevelMetrics(
  stored: StoredTradeLevels,
  metrics: Record<string, string> | null | undefined,
): Record<string, string> {
  const derived: Record<string, string> = {};
  for (const chip of tradeLevelChips(buildTradeLevelModel(stored))) {
    derived[chip.label] = chip.value;
  }
  return replaceLevelKeys(metrics, derived);
}

/** One level chip on the PM hero's metrics grid: a `<dt>` name and a `<dd>`
 *  value. `key` is a React list key only — never displayed. */
export type TradeLevelChip = { key: string; label: string; value: string };

/**
 * The PM hero's level chips, named by the same rule as every other surface.
 *
 * The hero is the fourth surface to need these, and the first to need them on a
 * READ. The PM's stored `metrics` map cannot supply them: a pre-FIX-780 PM
 * record always carries `stop` / `target` (the old `portfolioDecisionOutputSchema`
 * required both on every stance), and a post-fix DIRECTIONAL record carries the
 * same two keys, correctly derived at commit. The shapes are identical and the
 * meanings are opposite, so the chips are derived from the trader's stance and
 * typed levels instead — the same inputs `withDerivedLevelMetrics` uses at commit.
 *
 * A legacy record's numbers are captioned, not suppressed and not renamed: the
 * pair gets a name and neither number does, exactly as the decision one-liner
 * does through {@link formatLegacyLevels}. Suppressing them would discard
 * measurements the desk really took; renaming them would be a guess wearing a
 * stored record's authority.
 */
export function tradeLevelChips(
  levels: TradeLevelModel | null,
): TradeLevelChip[] {
  if (levels === null || levels.rows.length === 0) return [];
  if (levels.predatesLabelingFix) {
    return [
      {
        key: "__legacy_levels__",
        label: LEGACY_LEVELS_CAPTION,
        value: levels.rows.map((r) => `$${r.value}`).join(", "),
      },
    ];
  }
  return levels.rows.map((r) => ({
    key: r.label,
    label: r.label,
    value: `$${r.value}`,
  }));
}

/**
 * The non-level fields the trade one-liner shows around its levels.
 *
 * Structural rather than an import of `components/summary/aggregate`'s
 * `TradeLevels`: this leaf is dependency-free by design (it is imported from
 * both the server-side flow and the client bundle), so it describes the shape it
 * needs and lets the aggregate's type satisfy it.
 */
type TradeLineFields = {
  direction: TradeStance;
  sizePct: number | null;
  holdingPeriod: string | null;
};

/**
 * The trade one-liner's segments, in display order. An unpublished leg
 * contributes no segment rather than a `—` placeholder, so an empty result means
 * the trader published no levels at all.
 *
 * The level segments are named by {@link buildTradeLevelModel}, never here: this
 * line said "stop 320 · target 195" on a flat, no-position call before that rule
 * existed. A pre-fix record's two numbers collapse into one captioned segment
 * ({@link formatLegacyLevels}), because the record supports a name for the pair
 * and not for either one.
 *
 * Lives beside the rule rather than in the component that renders it: it is a
 * domain formatter over a stored record, and the tests that pin the one-liner's
 * wording should not have to import a React module to reach it.
 */
export function tradeLineParts(
  trade: TradeLineFields,
  levels: TradeLevelModel,
): ReadonlyArray<string> {
  const parts: string[] = [];
  if (trade.direction !== null) parts.push(trade.direction.toUpperCase());
  // `sizePct` is "% of NAV as the trader proposed it" — labeled exactly that,
  // never a dollar amount (no account value in scope; spec 06 §9.1).
  if (trade.sizePct !== null) parts.push(`${trade.sizePct}% NAV`);
  if (levels.predatesLabelingFix) {
    parts.push(formatLegacyLevels(levels.rows));
  } else {
    for (const row of levels.rows) parts.push(`${row.label} ${row.value}`);
  }
  if (trade.holdingPeriod !== null) parts.push(trade.holdingPeriod);
  return parts;
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
