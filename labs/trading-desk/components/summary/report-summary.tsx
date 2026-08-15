/**
 * ReportSummary — the Summary tab's top-level view. Aggregates a finished
 * report's ALREADY-STORED state (memos + valuation spine + price-history slice)
 * into a single at-a-glance page. Zero re-run, zero model spend: everything is
 * read from the hydrated session snapshot via `useSession`-backed hooks.
 *
 * Layout, top to bottom (spec 06 §1):
 *   decision header → conviction strip → analyst TLDR grid → factor + scenario
 *   charts → price & levels → risks & dependencies → thesis alignment.
 *
 * Real-money gates held here:
 *   - every figure traces to a named stored field (via `buildReportSummary`);
 *     nothing is computed from thin air.
 *   - charts never render against missing data — they show ChartEmpty + the gap.
 *   - a stopped run shows only its stop banner, never a half-built decision.
 *   - the persistent StatusBar not-advice disclaimer stays visible (owned by the
 *     page shell; this view never hides chrome).
 *   - portfolio-fit + lens-convergence (Slice 6) render the PM memo's stored
 *     `portfolioFit` / `lensConvergence` mirrors and OMIT cleanly when absent —
 *     a portfolio-blind or cost-gated run shows neither, never a stubbed
 *     position. The weight before/after block additionally requires
 *     `hasPortfolioContext` (a no-portfolio run has no current weight to chart).
 */
"use client";

import { useMemo, type ReactElement } from "react";
import type { SessionView } from "@flow-state-dev/react";
import {
  useClientData,
  useResource,
  useResourceCollectionList,
} from "@flow-state-dev/react";
import {
  COLLECTION_KEY_TO_SHORT,
  type AnyMemoShortName,
} from "@/flows/analysis/registry";
import type { MemoState } from "@/flows/analysis/resources";
import type { ValuationSpineState } from "@/flows/analysis/valuation-spine-resource";
import type { PriceHistorySlice } from "@/flows/analysis/price-history-resource";
import {
  buildTradeLevelModel,
  LEGACY_LEVELS_CAPTION,
  storedTradeLevelsFrom,
  type TradeLevelKind,
} from "@/flows/analysis/lib/trade-levels";
import { buildReportSummary } from "./aggregate";
import { DecisionHeader } from "./decision-header";
import { ConvictionStrip } from "./conviction-strip";
import { AnalystTldrGrid } from "./analyst-tldr-grid";
import { ResearchSynthesisBlock } from "./research-synthesis-block";
import { RiskPanel } from "./risk-panel";
import { InvalidationList } from "./invalidation-list";
import { ChartEmpty } from "./chart-empty";
import { BarGroup } from "./charts/bar-group";
import { ScenarioStrip } from "./charts/scenario-strip";
import { PriceOverlay, type PriceOverlayLevel } from "./charts/price-overlay";
import { PortfolioFitBlock } from "./portfolio-fit-block";
import { LensConvergenceBlock } from "./lens-convergence-block";
import { MandatePanel } from "../theses/mandate-panel";
import { ReportThesisPanel } from "../theses/report-thesis-panel";
import { cn } from "@/lib/utils";

export type ReportSummaryProps = {
  session: SessionView;
};

/**
 * A single resource that's unwritten surfaces in the client snapshot as `{}`
 * (not null) — a projection-config quirk. Treat snapshot `clientData` as
 * untrusted shape: coerce a non-object, or one missing its discriminating
 * field, to null — the value every consumer below expects for "absent".
 */
function asState<T>(raw: unknown, discriminator: keyof T & string): T | null {
  return raw !== null &&
    typeof raw === "object" &&
    (raw as Record<string, unknown>)[discriminator] !== undefined
    ? (raw as T)
    : null;
}

export function ReportSummary({ session }: ReportSummaryProps): ReactElement {
  const { items } = useResourceCollectionList(session, "memos", { limit: 50 });
  const { clientData: spineRaw } = useResource(session, "valuationSpine");
  const { clientData: priceRaw } = useResource(session, "priceHistory");
  const { session: stop } = useClientData(session, {
    session: ["stoppedReason", "stoppedMessage", "runComplete"],
  });

  const stoppedReason = (stop?.stoppedReason ?? null) as string | null;
  const stoppedMessage = (stop?.stoppedMessage ?? null) as string | null;

  // Build the view model from stored state. Derived, not a side effect → useMemo
  // (BP-010), keyed on the raw inputs.
  const summary = useMemo(() => {
    const byKey = new Map<AnyMemoShortName, MemoState | null>();
    for (const item of items) {
      const short = COLLECTION_KEY_TO_SHORT[item.topic];
      if (short === undefined) continue;
      byKey.set(short, (item.clientData ?? null) as MemoState | null);
    }
    return buildReportSummary(byKey, asState<ValuationSpineState>(spineRaw, "setupScore"));
  }, [items, spineRaw]);

  const price = asState<PriceHistorySlice>(priceRaw, "bars");

  // Stopped run: show only the stop banner — never a half-built decision.
  if (stoppedReason !== null) {
    return (
      <div className="flex flex-col gap-4">
        <div
          className={cn(
            "flex flex-col gap-1 rounded-md border p-4",
            "border-[color:var(--c-warn)]/40 bg-[color:var(--c-warn)]/10",
          )}
        >
          <span className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-warn)]">
            run stopped
          </span>
          <p className="text-[12.5px] text-[color:var(--c-fg)]">
            {stoppedMessage ?? "This run stopped before producing a decision."}
          </p>
        </div>
      </div>
    );
  }

  const hasSpine = summary.factorScores !== null;
  const hasScenarios = summary.scenarios.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <DecisionHeader
        ticker={summary.ticker}
        date={summary.date}
        decision={summary.decision}
        trade={summary.trade}
      />

      {/* FIX-760: adopt-as-thesis + the standing-thesis card for the analyzed
          name. Pass the REAL `runComplete` (not hard-coded true): the Summary tab
          can be opened manually mid-run, and `runComplete` flips only after the PM
          commit writes the decision snapshot, so the adopt button never offers an
          action that would fail with `no-decision`. */}
      <ReportThesisPanel
        session={session}
        ticker={summary.ticker === "" ? null : summary.ticker}
        runComplete={stop?.runComplete === true}
      />

      <ConvictionStrip nodes={summary.conviction} />

      {/* The research manager's synthesis in words — its stance, its conviction,
          and where the analysts still disagree. It sits directly under the strip
          because it is what the strip's spread means (FIX-1060). */}
      <ResearchSynthesisBlock synthesis={summary.researchSynthesis} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Factor scores</SectionLabel>
          {hasSpine ? (
            <BarGroup
              rows={[
                { label: "value", value: summary.factorScores!.value },
                { label: "quality", value: summary.factorScores!.quality },
                { label: "factor", value: summary.factorScores!.factor },
                { label: "momentum", value: summary.factorScores!.momentum },
              ]}
            />
          ) : (
            <ChartEmpty label="Valuation spine not computed for this run" />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Scenarios</SectionLabel>
          {hasScenarios ? (
            <ScenarioStrip
              scenarios={summary.scenarios}
              distribution={summary.distribution}
            />
          ) : (
            <ChartEmpty label="No scenario forecast for this run" />
          )}
        </div>
      </div>

      <SectionLabel>Price &amp; levels</SectionLabel>
      <PricePanel price={price} trade={summary.trade} />

      <RiskPanel
        criticalRisks={summary.criticalRisks}
        verdict={summary.riskVerdict}
        keyDependencies={summary.keyDependencies}
      />

      {summary.thesisAlignment.alignment !== null ? (
        <p className="text-[11px] text-[color:var(--c-fg-muted)]">
          <span className="font-mono uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            Thesis alignment
          </span>{" "}
          {summary.thesisAlignment.alignment}
          {summary.thesisAlignment.confidence !== null
            ? ` · ${summary.thesisAlignment.confidence.toFixed(2)}`
            : ""}
        </p>
      ) : null}

      {/* Slice 6: portfolio weight before/after block + lens-convergence card,
          read from the PM memo's stored `portfolioFit` / `lensConvergence`
          mirrors. Each omits cleanly when absent — never a stubbed position
          (spec 06 §9.5). The weight block additionally requires a real portfolio
          (`hasPortfolioContext`); a no-portfolio run has no current weight. */}
      {summary.portfolioFit !== null &&
      summary.portfolioFit.hasPortfolioContext ? (
        <>
          <SectionLabel>Portfolio fit</SectionLabel>
          <PortfolioFitBlock fit={summary.portfolioFit} />
        </>
      ) : null}

      {summary.lensConvergence !== null ? (
        <>
          <SectionLabel>Investor lenses</SectionLabel>
          <LensConvergenceBlock convergence={summary.lensConvergence} />
        </>
      ) : null}

      {/* FIX-752: risk-appetite mandate verdict, read from the PM memo's stored
          `mandateDecision` mirror. Omitted cleanly on a mandate-blind run —
          never a stubbed verdict. */}
      {summary.mandateDecision !== null ? (
        <>
          <SectionLabel>Risk-appetite mandate</SectionLabel>
          <MandatePanel decision={summary.mandateDecision} />
        </>
      ) : null}

      <SectionLabel>Analyst TLDRs</SectionLabel>
      <AnalystTldrGrid analysts={summary.analysts} />
    </div>
  );
}

function SectionLabel({
  children,
}: {
  children: React.ReactNode;
}): ReactElement {
  return (
    <h2 className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
      {children}
    </h2>
  );
}

/**
 * Line colour per level kind. Presentation only — the NAME of a level is the
 * shared rule's (`buildTradeLevelModel`), never this table's. A flat run's two
 * monitoring levels share one colour because they are one kind of thing: lines
 * the desk is watching, not lines a position hangs off. A pre-fix record's
 * unnamed levels are drawn muted, matching how little the record can claim.
 */
const LEVEL_COLORS: Record<TradeLevelKind, string> = {
  stop: "var(--c-warn)",
  target: "var(--c-live)",
  monitoring: "var(--c-accent)",
  legacy: "var(--c-fg-faint)",
};

/**
 * Price panel: draws the close-price overlay when a series exists; otherwise
 * falls back to a trade-levels list so the panel still earns its space. The
 * `source` provenance tag is surfaced so a `"unavailable"` slice reads as
 * missing signal, never a real series.
 */
function PricePanel({
  price,
  trade,
}: {
  price: PriceHistorySlice | null;
  trade: ReturnType<typeof buildReportSummary>["trade"];
}): ReactElement {
  const hasSeries =
    price !== null && price.source !== "unavailable" && price.bars.length >= 2;

  // The spine's fairValue is a company-level $B figure (a fair market cap),
  // not a share price — it must never join the price-axis levels (FIX-778).
  //
  // The legend text comes from the shared labeling rule (FIX-780), so the chart
  // cannot call a level something the list beside it does not. Only the colour
  // is the chart's own, keyed off `kind`. A pre-fix flat record's levels are
  // drawn unlabeled — the numbers are real, the names are not recoverable.
  const levelModel = buildTradeLevelModel(storedTradeLevelsFrom(trade ?? {}));
  const levels: PriceOverlayLevel[] = levelModel.rows.map((row) => ({
    label: row.label,
    value: row.value,
    color: LEVEL_COLORS[row.kind],
  }));
  // Close line only when the series actually renders (consistent with
  // hasSeries) — never dead work on the unavailable/short-series fallback.
  if (hasSeries && price) {
    levels.unshift({
      label: "close",
      value: price.bars[price.bars.length - 1].close,
      color: "var(--c-fg-muted)",
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {hasSeries ? (
        <>
          <PriceOverlay bars={price.bars} levels={levels} />
          <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            source: {price.source}
            {price.range !== "" ? ` · ${price.range}` : ""}
          </span>
        </>
      ) : (
        <>
          <ChartEmpty label="Price history unavailable for this run" />
          <TradeLevelsList trade={trade} />
        </>
      )}
    </div>
  );
}

/**
 * The levels panel shown when the price chart can't draw. It carries the
 * trader's invalidation criteria alongside the numbers: this block is the only
 * "Price & levels" content on such a run, and levels without what invalidates
 * them is half the trade (FIX-1060).
 */
function TradeLevelsList({
  trade,
}: {
  trade: ReturnType<typeof buildReportSummary>["trade"];
}): ReactElement | null {
  const rows: Array<{ label: string; value: string }> = [];
  if (trade?.direction != null)
    rows.push({ label: "direction", value: trade.direction });
  if (trade?.sizePct != null)
    rows.push({ label: "size", value: `${trade.sizePct}% NAV` });

  // Level names come from the shared rule (FIX-780) — this list never spells
  // them itself. A pre-fix record collapses to a single captioned row: the two
  // numbers are real, but nothing in the record says which is which, so naming
  // either one would be a guess wearing a stored value's authority. The
  // disclosure itself belongs to the report's ONE shared provenance notice,
  // never to a second marker down here.
  const levels = buildTradeLevelModel(storedTradeLevelsFrom(trade ?? {}));
  if (levels.predatesLabelingFix) {
    rows.push({
      label: LEGACY_LEVELS_CAPTION,
      value: levels.rows.map((r) => String(r.value)).join(", "),
    });
  } else {
    for (const row of levels.rows)
      rows.push({ label: row.label, value: String(row.value) });
  }

  const invalidation = trade?.invalidationCriteria ?? null;
  const hasInvalidation = invalidation !== null && invalidation.length > 0;
  if (rows.length === 0 && !hasInvalidation) return null;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-md border p-3",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
    >
      {rows.length > 0 ? (
        <dl
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          aria-label="Decision levels"
        >
          {rows.map((r) => (
            <div key={r.label} className="flex flex-col gap-0.5">
              <dt className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                {r.label}
              </dt>
              <dd className="font-mono text-[12px] text-[color:var(--c-fg)]">
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <InvalidationList criteria={invalidation} />
    </div>
  );
}
