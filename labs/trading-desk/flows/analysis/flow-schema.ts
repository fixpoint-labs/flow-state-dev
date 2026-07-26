/**
 * `analyzeInputSchema` lifted out of `flow.ts` so guard handlers can import
 * it without creating a cycle through the flow definition.
 *
 * The portfolio sub-schemas (Slice 5) are resource-state shapes, NOT generator
 * outputs — so `z.record()`, `.default()`, and `.nullable()` are all fine here
 * (BP-016 only constrains generator output shapes). Do not "fix" them to strict
 * shape.
 *
 * `portfolio` was removed from `analyzeInputSchema` in Task 2: the snapshot is
 * now computed server-side by `seedSession` from the app-owned `accounts` /
 * `holdings` / `quotes` tables (FIX-772/FIX-823). `portfolioContextInput` is kept as an export
 * because it is the type of the `state.portfolio` field and is referenced by
 * `state.ts` and `build-portfolio-context.ts`.
 */
import { z } from "zod";
import { riskMandateIdSchema } from "./lib/risk-mandate";

/**
 * One holding line within the computed portfolio snapshot. `seedSession`
 * computes `marketValue` / `weightPct` server-side from the Slice-4 stored
 * `quantity` × a last-known `app.quotes` price (FIX-823) — the flow never recomputes them
 * downstream. A ticker with no live quote degrades to `marketValue: null`
 * / `weightPct: null` (NEVER a fabricated price). `sector` is best-effort (the
 * Slice-4 model does not store it, so it is null today).
 */
const portfolioHoldingInput = z.object({
  ticker: z.string().min(1),
  account: z.string().min(1), // account id, joins to portfolioAccountInput.id
  weightPct: z.number().nullable().default(null), // % of total NAV (0–100); null when price unknown
  marketValue: z.number().nullable().default(null),
  costBasis: z.number().nullable().default(null),
  sector: z.string().nullable().default(null),
});

/** One selected account's cash + type, mapped from the Slice-4 account record. */
const portfolioAccountInput = z.object({
  id: z.string().min(1), // the Slice-4 accountId
  label: z.string().min(1), // the Slice-4 account name (validated against on suggestedAccount)
  type: z.enum(["taxable", "IRA", "Roth", "401k"]),
  cash: z.number(), // cashBalance for this account
});

/**
 * Compact household-health aggregate (FIX-762) injected into the trader/PM
 * context alongside the raw holdings list — the deterministic answer to "how
 * balanced is this book?" the desk's sizing/concentration commentary can
 * reference. Aggregates only (no per-position list beyond what `holdings`
 * already carries). Null when health is not computable (no priced data).
 *
 * `drift` is the FIX-761-gated slice (actual-vs-target against the durable
 * mandate); it is always null until that lands — the shape is here so the
 * follow-up only populates it (no schema churn). Domain-regime schema
 * (nullable/defaults fine; NOT a strict generator output).
 */
const portfolioHealthContext = z.object({
  cashPct: z.number().nullable(),
  coveragePct: z.number().nullable(),
  assetClassAllocation: z.array(z.object({ assetClass: z.string(), pct: z.number().nullable() })),
  sectorExposure: z.array(z.object({ bucket: z.string(), pct: z.number().nullable() })), // top 6 + "Other"
  concentration: z.object({
    maxPosition: z.object({ ticker: z.string(), weightPct: z.number() }).nullable(),
    top5Pct: z.number().nullable(),
    effectivePositions: z.number().nullable(),
    flags: z.array(z.string()), // pre-rendered, e.g. "NVDA 12.4% (warn)"
  }),
  drift: z
    .object({
      totalDriftPct: z.number(),
      rebalanceSuggested: z.boolean(),
      breaches: z.array(z.string()), // pre-rendered, e.g. "fixed_income 24% vs target 30 — LOW"
    })
    .nullable(), // null = no mandate (FIX-761-gated; always null in v1)
  /**
   * The ETF look-through second axis (FIX-801) — effective exposure SEEING
   * INSIDE funds, beside the wrapper-basis fields above (Decision 2: additive,
   * never a replacement). Null when nothing was attributed through a fund (no
   * funds held, none attributable, or the analysis seed reads the profiles
   * table read-only and nobody has warmed it for these tickers yet — Decision
   * 1's documented "browser sees `partial`, a cold headless run may see
   * `none`" divergence). `maxPosition`/`flags` are LOWER BOUNDS (Decision 3) —
   * uncovered fund weight is a residual, never renormalized, so a look-through
   * flag firing is trustworthy but one NOT firing is not a clean bill of
   * health. These figures do NOT move the deterministic decision gates
   * (mandate / policy / evidence) — narrative context only (spec Non-goals).
   */
  lookThrough: z
    .object({
      coveragePct: z.number().nullable(),
      sectorCoveragePct: z.number().nullable(),
      maxPosition: z.object({ ticker: z.string(), weightPct: z.number() }).nullable(),
      // The look-through analogue of the wrapper-basis `concentration.effectivePositions`
      // above, but an uncertainty-aware INTERVAL rather than a point estimate
      // (Decision 4, docs/etf-look-through.md): the unattributed residual could
      // sit anywhere from a long tail (`high`) to piling entirely onto the
      // largest name already seen (`low`). Null exactly when the wrapper leaf's
      // own `effectivePositions` is null (no attribution). Already computed by
      // the leaf but never threaded through until now — pure wiring, no b-side
      // change (Codex review, FIX-801 sub-PR c).
      effectivePositions: z.object({ low: z.number(), high: z.number() }).nullable(),
      flags: z.array(z.string()), // pre-rendered, e.g. "NVDA 16.9% (alert, look-through)"
      opaqueFundCount: z.number(), // funds left unattributed, total
      // Subset of opaqueFundCount that is merely temporarily unavailable
      // (never fetched yet, or a fetch that's quota/rate-limited and will be
      // retried) rather than a genuine data-quality finding (thin coverage,
      // malformed data, leveraged/fund-of-funds exclusion, or a
      // provider-confirmed non-ETF). Lets the prompt distinguish "we haven't
      // looked yet" from "we looked and it's not attributable" instead of
      // uniformly reporting every opaque fund as a data-quality judgment
      // (Codex review, FIX-801 sub-PR c).
      opaqueUnavailableFundCount: z.number(),
    })
    .nullable(),
});

/**
 * Optional per-run portfolio context. Null/absent → the run is portfolio-blind
 * exactly as today. The pipeline (P1–P2) never sees this; only the lens pack,
 * the trader (P3), and the PM (P5) read it via the `portfolioContext` preset.
 *
 * `totalNav` = Σ(holding.marketValue, when known) + Σ(account.cash), computed
 * server-side at seed. `snapshotAsOf` carries the quotes' as-of so the PM/UI
 * can label staleness (RISK-P3) — a frozen snapshot is never presented as live.
 * `pricedHoldings` / `totalHoldings` let the prompt + UI state coverage honestly
 * (e.g. "12 of 18 holdings priced") without fabricating the missing values.
 * `health` is the compact FIX-762 household aggregate (null when not computable).
 */
const portfolioContextInput = z.object({
  totalNav: z.number(),
  snapshotAsOf: z.string().nullable().default(null),
  pricedHoldings: z.number().default(0),
  totalHoldings: z.number().default(0),
  accounts: z.array(portfolioAccountInput),
  holdings: z.array(portfolioHoldingInput),
  health: portfolioHealthContext.nullable().default(null),
});

export type PortfolioContextInput = z.infer<typeof portfolioContextInput>;

export { portfolioContextInput };

export const analyzeInputSchema = z.object({
  ticker: z.string().min(1).default("NVDA"),
  date: z.string().min(1).default("2026-05-06"),
  costPreset: z.enum(["fast", "full"]).default("fast"),
  dataSource: z.enum(["fixture", "live", "record"]).default("fixture"),
  // Optional per-run user thesis. The pipeline (P1–P5) never sees these —
  // they feed the Phase 6 post-decision audit only. A non-null `userThesis`
  // gates Phase 6; null skips it entirely.
  userThesis: z.string().max(1500).nullable().default(null),
  userThesisRationale: z.string().max(1500).nullable().default(null),
  // Which account(s) the user is considering this position for. Empty → let the
  // PM suggest. Does NOT join the session keying tuple in v1 — account selection
  // is a refinement, not a new report. The portfolio snapshot itself is computed
  // server-side by `seedSession` from the app-owned accounts + holdings + quotes
  // tables (FIX-772/FIX-823), so no `portfolio` field is passed from the client.
  selectedAccountIds: z.array(z.string()).default([]),
  // Optional per-run risk-appetite mandate override (FIX-752) — one of the
  // MANDATE_PACK ids. Null → fall back to the selected accounts' default(s) at
  // seed; if none resolve, the run is mandate-blind. Does NOT join the session
  // keying tuple: changing the mandate refines an analysis, it is not a new
  // report (the `selectedAccountIds` precedent).
  riskMandate: riskMandateIdSchema.nullable().default(null),
});

export type AnalyzeInput = z.infer<typeof analyzeInputSchema>;
