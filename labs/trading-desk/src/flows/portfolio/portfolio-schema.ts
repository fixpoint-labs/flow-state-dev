/**
 * Pure, browser-safe portfolio domain schemas.
 *
 * This is the load-bearing leaf for Spine B (the portfolio data model). It
 * imports ONLY `zod` — no `@flow-state-dev/core` — so it runs identically in
 * the client (the import dialog's live preview) and in the server action, and
 * is unit-testable without a runtime (BP-019: leaf module, no cycles).
 *
 * The model is ONE collection: `accounts` (keyed `accountId`). A holding is
 * NOT its own resource — each account record carries its holdings inline as a
 * `Holding[]` array. The per-account record is the write unit: importing a
 * brokerage statement is a single write to one account, not one write per
 * ticker. This is fine because the data is small and rarely-changing JSON
 * written in batches (an import or a manual edit), so re-serializing an
 * account's holdings array on each write costs nothing and there is no
 * concurrent-row-write race to isolate.
 *
 * These are RESOURCE STATE schemas, not generator outputs — `.default()` /
 * `.nullable()` are fine here (BP-016 only constrains generator output shapes).
 */
import { z } from "zod";

/** Account tax/registration type. Drives no logic in v1 (display chip only),
 *  but it is the field a future tax-lot / wash-sale model keys off. */
export const accountTypeSchema = z.enum(["taxable", "IRA", "Roth", "401k"]);
export type AccountType = z.infer<typeof accountTypeSchema>;

/** Allocation bucket — the NOT NULL field every drift/exposure/mandate consumer groups on. */
export const assetClassSchema = z.enum(["equity", "fixed_income", "cash", "crypto", "alternative"]);
export type AssetClass = z.infer<typeof assetClassSchema>;

/** Instrument type — display + valuation routing. text-with-zod-enum (accounts.type precedent). */
export const assetTypeSchema = z.enum([
  "equity",
  "etf",
  "mutual_fund",
  "bond",
  "money_market",
  "crypto",
  "option",
  "other",
]);
export type AssetType = z.infer<typeof assetTypeSchema>;

/** Per-type attributes, discriminated by `kind`. Lab-honest minimum, not a full security master.
 *  The `none` member is the default for equity / etf / mutual_fund / crypto / other. */
export const holdingAttributesSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("bond"),
    cusip: z.string().nullable().default(null),
    coupon: z.number().nullable().default(null),
    maturity: z.string().nullable().default(null),
    yield: z.number().nullable().default(null),
  }),
  z.object({
    kind: z.literal("option"),
    underlying: z.string(),
    strike: z.number(),
    expiry: z.string(),
    right: z.enum(["call", "put"]),
    multiplier: z.number().default(100),
  }),
  z.object({ kind: z.literal("cash_equivalent"), yield: z.number().nullable().default(null) }),
  z.object({ kind: z.literal("none") }),
]);
export type HoldingAttributes = z.infer<typeof holdingAttributesSchema>;

/**
 * One holding — the `(account, ticker)` unit, stored inline in its account's
 * `holdings` array. The `ticker` identifies the row within the account; the
 * account is identified by the record it lives in (no `accountId` field — a
 * holding is exactly a {@link CanonicalRow}).
 *
 * `costBasis` is AVERAGE cost per share, INFORMATIONAL only — it is tax-wrong
 * (wash sales, specific-lot selection, holding-period are not modeled). The UI
 * must not imply tax accuracy.
 *
 * FUTURE SEAM — tax-lots: add `lots: z.array(lotSchema)` later; `costBasis`
 * becomes the derived average over lots and `acquiredDate` becomes
 * `min(lot.date)`. No rename — these v1 avg-cost fields are forward-compatible.
 */
export const holdingSchema = z.object({
  /** Normalized upper-case ticker (see `portfolio-csv.ts` validation). */
  ticker: z.string(),
  /** Fractional shares supported (e.g. 0.4213 of BRK.A). */
  quantity: z.number(),
  /** Average cost per share in the account's currency. Blank import → null. */
  costBasis: z.number().nullable().default(null),
  /** Earliest acquisition date (earliest lot date once lots exist). */
  acquiredDate: z.string().nullable().default(null),
  /** Allocation bucket the drift/exposure/mandate consumers group on. Defaults
   *  to `equity` so existing equity-only fixtures and call sites stay valid; the
   *  importers assign the real class in a later slice (FIX-773 Slice B). */
  assetClass: assetClassSchema.default("equity"),
  /** Instrument type driving display + valuation routing. Defaults to `equity`. */
  assetType: assetTypeSchema.default("equity"),
  /** Per-type attributes, discriminated by `kind`. Defaults to `{ kind: "none" }`. */
  attributes: holdingAttributesSchema.default({ kind: "none" }),
});
export type Holding = z.infer<typeof holdingSchema>;

/**
 * One brokerage/retirement account, with its holdings inline. `cashBalance`
 * lives here (it is per-account, not per-ticker, so it is NOT a holding).
 * Single-currency per account in v1; multi-currency is a documented future
 * seam.
 *
 * FUTURE SEAM — realized P/L + dividends: a future `accountLedgerSchema`
 * collection (`pattern: "ledger/*"`, keyed by event id) records cash events.
 * Not built now; this comment is the only obligation v1 owes it.
 */
export const accountStateSchema = z.object({
  /** Stable id, also the `accounts/{accountId}` collection-key suffix.
   *  Generated `crypto.randomUUID()` at create time (opaque, collision-free —
   *  see spec §12.3). */
  accountId: z.string(),
  name: z.string().min(1).max(80),
  type: accountTypeSchema,
  /** ISO 4217. Single-currency per account in v1. */
  currency: z.string().length(3).default("USD"),
  /** Settled cash in the account's currency. Fractional allowed. v1 uses a
   *  JS float — display approximation, not precise accounting (RISK-P5). */
  cashBalance: z.number().default(0),
  /** The account's positions. Empty on a fresh account; populated by import or
   *  manual edit. Replacing this array IS the import write. */
  holdings: z.array(holdingSchema).default([]),
  /** Default risk-appetite mandate id for this book (FIX-752), or null for no
   *  default. Stored as an OPAQUE string so this portfolio leaf stays decoupled
   *  from the analysis flow's mandate vocabulary; the analysis flow validates it
   *  via `resolveMandate` at seed (an unknown / stale id resolves to
   *  mandate-blind, never throws). A per-run override beats this default. */
  riskMandate: z.string().nullable().default(null),
  /** Audit timestamps. Plain ISO strings. */
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AccountState = z.infer<typeof accountStateSchema>;

/** The four canonical CSV columns the parser maps every brokerage export onto.
 *  Shared by the parser and the import action. A {@link Holding} is exactly a
 *  `CanonicalRow`. */
export type CanonicalRow = {
  ticker: string;
  quantity: number;
  /** Average cost per share; null when the export carries no cost column. */
  costBasis: number | null;
  /** ISO `YYYY-MM-DD`; null when absent or unparseable (a bad date is a
   *  warning, not a row rejection). */
  acquiredDate: string | null;
  /** Allocation bucket. The importers default this to `equity` in Slice A and
   *  assign the real class in Slice B (FIX-773). */
  assetClass: AssetClass;
  /** Instrument type (display + valuation routing). */
  assetType: AssetType;
  /** Per-type attributes, discriminated by `kind` (`{ kind: "none" }` for
   *  equity-shaped rows). */
  attributes: HoldingAttributes;
};

/** Import merge mode. `upsert` (default) is non-destructive; `replace-account`
 *  is the explicit, confirmed full-snapshot mode (RISK-P6 — non-atomic). */
export type ImportMode = "upsert" | "replace-account";
