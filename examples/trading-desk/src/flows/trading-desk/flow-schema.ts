/**
 * `analyzeInputSchema` lifted out of `flow.ts` so guard handlers can import
 * it without creating a cycle through the flow definition.
 *
 * The portfolio sub-schemas (Slice 5) are caller input validated by a handler,
 * NOT generator outputs — so `z.record()`, `.default()`, and `.nullable()` are
 * all fine here (BP-016 only constrains generator output shapes). Do not "fix"
 * them to strict shape.
 */
import { z } from "zod";

/**
 * One holding line within the dispatched portfolio snapshot. The CLIENT
 * (`app/page.tsx`) computes `marketValue` / `weightPct` at dispatch from the
 * Slice-4 stored `quantity` × a live `portfolioQuotes` price — the flow never
 * recomputes them. A ticker with no live quote degrades to `marketValue: null`
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
 * Optional per-run portfolio context. Null/absent → the run is portfolio-blind
 * exactly as today. The pipeline (P1–P2) never sees this; only the lens pack,
 * the trader (P3), and the PM (P5) read it via the `portfolioContext` preset.
 *
 * `totalNav` = Σ(holding.marketValue, when known) + Σ(account.cash), computed by
 * the client at dispatch. `snapshotAsOf` carries the quotes' as-of so the PM/UI
 * can label staleness (RISK-P3) — a frozen snapshot is never presented as live.
 * `pricedHoldings` / `totalHoldings` let the prompt + UI state coverage honestly
 * (e.g. "12 of 18 holdings priced") without fabricating the missing values.
 */
const portfolioContextInput = z.object({
  totalNav: z.number(),
  snapshotAsOf: z.string().nullable().default(null),
  pricedHoldings: z.number().default(0),
  totalHoldings: z.number().default(0),
  accounts: z.array(portfolioAccountInput),
  holdings: z.array(portfolioHoldingInput),
});

export type PortfolioContextInput = z.infer<typeof portfolioContextInput>;

export { portfolioContextInput };

export const analyzeInputSchema = z.object({
  ticker: z.string().min(1).default("NVDA"),
  date: z.string().min(1).default("2026-05-06"),
  costPreset: z.enum(["fast", "full"]).default("fast"),
  dataSource: z.enum(["fixture", "live"]).default("fixture"),
  // Optional per-run user thesis. The pipeline (P1–P5) never sees these —
  // they feed the Phase 6 post-decision audit only. A non-null `userThesis`
  // gates Phase 6; null skips it entirely.
  userThesis: z.string().max(1500).nullable().default(null),
  userThesisRationale: z.string().max(1500).nullable().default(null),
  // Optional per-run portfolio snapshot (Slice 5). Null → portfolio-blind run.
  // Frozen onto session state at seed time (same precedent as `userThesis`).
  portfolio: portfolioContextInput.nullable().default(null),
  // Which account(s) the user is considering this position for. Empty → let the
  // PM suggest. Subset of `portfolio.accounts[].id`. Does NOT join the session
  // keying tuple in v1 (open-Q#2) — account selection is a refinement, not a new
  // report.
  selectedAccountIds: z.array(z.string()).default([]),
});

export type AnalyzeInput = z.infer<typeof analyzeInputSchema>;
