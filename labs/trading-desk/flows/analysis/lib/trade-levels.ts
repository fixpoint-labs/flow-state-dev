/**
 * The ONE rule that decides what a stored decision's price levels are called,
 * and the stance gate that decides which of them a run may store.
 *
 * Which pair belongs to which stance:
 *
 *  - **directional** (long / short) — a `stop` and a `target`.
 *  - **flat** (no position taken) — a `reassess below` and an `invalidate
 *    above`, and NO stop and NO target: there is no position to stop out of.
 *
 * Two exported halves of that one rule, deliberately in one file:
 * {@link levelsForStance} is the WRITE half (applied at the trader's commit),
 * {@link buildTradeLevelModel} the READ half. Every surface that shows a level
 * reads the READ half rather than spelling a label itself.
 *
 * Pure and dependency-free by design — imported from both the server-side flow
 * and the client bundle (the `lib/rating-engine` precedent). No React, no zod,
 * no `@flow-state-dev/core`.
 *
 * BP-030: records written before the monitoring fields existed carry no
 * monitoring keys at all, so every level input is read as
 * `number | null | undefined` and tested with `== null`. A missing key and an
 * explicit null are the same absence here.
 */

/** The stance a stored decision recorded. Null on a run that never reached the
 *  trader (stopped / in-progress), where nothing is shown at all. */
export type TradeStance = "long" | "short" | "flat" | null;

/**
 * Does this memo record a stance at all?
 *
 * The guard every caller needs before applying a level rule, and it must be
 * written POSITIVELY — never as an absence test. `direction` is
 * `.nullable().default(null)`, so a stance-less memo carries `null` and a
 * `=== undefined` guard would run the level rule over the analyst, lens, and
 * research memos, whose free-form `metrics` legitimately contain `target` and
 * `stop` keys (the bull thesis requires both).
 */
export function hasTradeStance(
  direction: unknown,
): direction is Exclude<TradeStance, null> {
  return direction === "long" || direction === "short" || direction === "flat";
}

/**
 * The four stored level fields plus the stance that says which pair is real.
 *
 * The level fields are optional AND nullable: a legacy decision record has no
 * `reassessBelowPrice` / `invalidateAbovePrice` keys, so reads see `undefined`
 * rather than `null` (BP-030 — the missing-key shape is the legacy shape, and it
 * is the majority of the stored corpus).
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

/**
 * Pack a memo, snapshot, or aggregate row into {@link StoredTradeLevels}.
 *
 * The ONE way callers assemble the input to the read half. Every surface holds
 * these five fields on some wider record, and hand-assembling the literal at
 * each one is how a surface comes to read three of the four levels. `direction`
 * is normalized through {@link hasTradeStance}, so a caller passes its record
 * straight in without an `?? null` or a cast.
 */
export function storedTradeLevelsFrom(source: {
  direction?: unknown;
  stopPrice?: number | null;
  targetPrice?: number | null;
  reassessBelowPrice?: number | null;
  invalidateAbovePrice?: number | null;
}): StoredTradeLevels {
  return {
    direction: hasTradeStance(source.direction) ? source.direction : null,
    stopPrice: source.stopPrice,
    targetPrice: source.targetPrice,
    reassessBelowPrice: source.reassessBelowPrice,
    invalidateAbovePrice: source.invalidateAbovePrice,
  };
}

/** What kind of level a row is. Consumers map this to presentation (the chart
 *  picks a colour off it); the *name* is always {@link TradeLevelRow.label}, so
 *  no surface invents its own spelling. */
export type TradeLevelKind = "stop" | "target" | "monitoring" | "legacy";

/** One level to show, already named. */
export type TradeLevelRow = {
  kind: TradeLevelKind;
  /**
   * What every surface calls this level. Canonical lower-case; a surface with a
   * different house style may re-case it, but must not rename it.
   *
   * Empty string for `kind: "legacy"` — a legacy flat record does not record
   * which of its two numbers was which, and naming one would be a guess
   * presented as a record.
   */
  label: string;
  value: number;
};

/** The named levels to show for one stored decision. */
export type TradeLevelModel = {
  /** The levels to show, in display order. Empty when the record has none —
   *  surfaces show nothing rather than a fabricated range. */
  rows: TradeLevelRow[];
  /**
   * True for a legacy flat record: it carries trade levels and no monitoring
   * levels, so its two numbers are shown unlabeled. Detection is by data SHAPE
   * and needs no version stamp.
   *
   * Renders NOTHING itself. It is the input to the report's one shared
   * provenance notice — see {@link PRE_FLAT_STANCE_LABELING_FIX_REASON}.
   */
  predatesLabelingFix: boolean;
};

// The canonical names of a flat run's two monitoring levels. Deliberately NOT
// exported: a consumer reads the name off the row it is rendering, so no call
// site needs to say the word itself. That is the guarantee.
const REASSESS_BELOW_LABEL = "reassess below";
const INVALIDATE_ABOVE_LABEL = "invalidate above";

/**
 * What a legacy record's levels are called COLLECTIVELY. There is no name for
 * either one — the caption names the pair, which is all the record supports.
 */
export const LEGACY_LEVELS_CAPTION = "levels recorded";

/**
 * What a reader is told about a legacy record's levels — ONE ENTRY in the
 * report's shared provenance-notice reason list, never a marker of its own.
 *
 * `ReportProvenanceNotice` is the single report-level "this predates a fix"
 * banner and takes a LIST of reasons, so nothing here renders a notice: this
 * file produces `predatesLabelingFix` and this string, and the report surface
 * appends it. Never add a second marker.
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
 * Two monitoring levels at the same price describe one decision line, not a
 * range. Applied only to the flat branches: a directional stop and target render
 * as two rows even in the degenerate case where they coincide.
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
 *  1. **Flat with monitoring levels** — shows the one or two it has, labeled. A
 *     missing partner is left missing; nothing is inferred from the one present.
 *  2. **Flat with only trade levels** — the legacy record
 *     (`predatesLabelingFix`). Shows the numbers unlabeled, in ASCENDING order:
 *     their stored `stop, target` order would leak the old field identity by
 *     position, which is the same guess-as-record the labels refuse to make.
 *  3. **Anything else** — the directional path. Monitoring levels on a
 *     directional record are ignored rather than shown under a name the stance
 *     cannot carry (the read-side mirror of {@link levelsForStance}).
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
 * The ONE way a legacy record's unlabeled levels are captioned, as a single
 * segment: `levels recorded: 195, 320`.
 *
 * Read by both surfaces that show a legacy record — the decision one-liner and
 * the trade-proposal prompt block — so the screen and the desk's own prompt
 * cannot caption the same two numbers differently. Only `formatValue` varies
 * (the prompt writes `$195`, the screen writes `195`).
 */
export function formatLegacyLevels(
  rows: readonly TradeLevelRow[],
  formatValue: (value: number) => string = String,
): string {
  return `${LEGACY_LEVELS_CAPTION}: ${rows.map((r) => formatValue(r.value)).join(", ")}`;
}

/**
 * The level entries of the trader memo's display `metrics` row, derived from the
 * typed level fields rather than taken from the model's own metric strings.
 *
 * The `metrics` row renders as `key=value` pairs into the trade-proposal prompt
 * block, so its KEYS are level names and fall under the same one rule.
 *
 * A row with no name (a legacy record) contributes no entry — a `key=value` row
 * cannot show an unlabeled number without inventing a key.
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
 * `stop` / `target` are here because they are what a legacy record's `metrics`
 * map persisted, and that stored map is a second, untyped copy of the level
 * names that no schema constrains.
 */
const LEVEL_METRIC_KEYS: ReadonlySet<string> = new Set([
  "stop",
  "target",
  REASSESS_BELOW_LABEL,
  INVALIDATE_ABOVE_LABEL,
]);

/**
 * Re-derive a stored `metrics` map's level entries from the typed levels — the
 * COMMIT/prompt path.
 *
 * The map is free-form and no schema constrains its keys, so it is a second copy
 * of the level names outside {@link buildTradeLevelModel}'s reach. Level keys are
 * DROPPED and replaced by what the typed fields support; non-level keys pass
 * through untouched. A legacy flat record supports no name for either number, so
 * it contributes no entry and the captioned line carries them instead.
 *
 * Position is preserved: derived entries land where the first level key sat, so
 * only a record that was actually mislabeled changes.
 */
export function withDerivedLevelMetrics(
  stored: StoredTradeLevels,
  metrics: Record<string, string> | null | undefined,
): Record<string, string> {
  return replaceLevelKeys(metrics, tradeLevelMetricEntries(stored));
}

/**
 * Drop every level-named key from a stored metrics map and put `derived` where
 * the first one sat. Shared by the three derivations so the placement rule (and
 * the "the rest are stale copies" rule) is written once.
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
 * The portfolio manager is that participant: its levels were only ever the
 * TRADER's, copied in for display, and the desk supports the two disagreeing.
 * Attribution works only where there is a surface to label it on, and
 * `formatMemoBlock` serializes the whole memo with nowhere to put one — so the
 * levels leave the PM's data instead, and consumers read the trader memo.
 */
export function withoutLevelMetrics(
  metrics: Record<string, string> | null | undefined,
): Record<string, string> {
  return replaceLevelKeys(metrics, {});
}

/**
 * The metrics map a RENDERED memo doc shows — the READ-path twin of
 * {@link withDerivedLevelMetrics}.
 *
 * Same correction, ONE DELIBERATE DIFFERENCE that keeps the two separate: a
 * legacy record's numbers are kept under the shared caption rather than dropped.
 * The prompt path can drop them because `formatTradeProposalExtensions`
 * discloses the pair a line below; a chip grid has no such second line.
 *
 * Needed because a memo doc opened from a HISTORICAL report never runs a commit,
 * so the stored map is whatever the run wrote.
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
 * Derived from the trader's stance and typed levels, never from the PM's stored
 * `metrics`: a legacy PM record and a post-fix DIRECTIONAL one both carry `stop`
 * / `target`, so the shapes are identical and the meanings are opposite.
 *
 * A legacy record's numbers are captioned, not suppressed and not renamed —
 * the pair gets a name and neither number does.
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
 * `TradeLevels`: this leaf is dependency-free by design, so it describes the
 * shape it needs and lets the aggregate's type satisfy it.
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
 * The level segments are named by {@link buildTradeLevelModel}, never here. A
 * legacy record's two numbers collapse into one captioned segment
 * ({@link formatLegacyLevels}).
 *
 * Lives beside the rule rather than in the component that renders it: it is a
 * domain formatter over a stored record.
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
 * deciding rather than trusting the answer (the `agreesWithTrader` precedent). A
 * flat run keeps the monitoring pair and stores no stop and no target; any other
 * stance does the reverse.
 *
 * A run that fills in the wrong pair LOSES those numbers, and they are never
 * re-filed under the other pair's names — nothing in the output says the model
 * meant them that way. Showing no levels is honest; storing a stop on a position
 * the desk did not take is not.
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
