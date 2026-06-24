/**
 * Pure view-model builder for one transaction-ledger row (FIX-774).
 *
 * Browser-safe (no framework imports). Mirrors `portfolio-format.ts`: this is
 * the ONE place the ledger's null-handling and the "—"-for-missing real-money
 * gate live, so `LedgerTable` stays dumb (the `aggregate.ts` / `holdings-row-
 * model` precedent). It reuses `formatMoney` / `formatSignedMoney` for currency
 * — it does NOT reimplement formatting.
 *
 * Signs are caller-canonical and surfaced as-is: a buy is a negative cash
 * `amount` with a positive `quantity`; a sell inverts both. Any missing real
 * value renders `DASH`, never 0 or a fabricated number. A non-null `basisUnknown`
 * (a transfer-in with no acquisition record) sets the badge flag; a non-null
 * `voidedAt` (a tombstoned row) sets the voided flag so the row renders muted.
 */
import type {
  LedgerRow,
  LedgerSource,
} from "@/src/flows/portfolio/ledger-schema";
import { DASH, formatSignedMoney } from "./portfolio-format";

/** Human label for each event kind. */
const TYPE_LABELS: Record<LedgerRow["type"], string> = {
  buy: "Buy",
  sell: "Sell",
  dividend: "Dividend",
  interest: "Interest",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  transfer: "Transfer",
  fee: "Fee",
};

/** Render-ready strings + flags for one ledger row. Every missing value is
 *  `DASH`, never a fabricated number. */
export type LedgerRowModel = {
  id: string;
  type: string;
  tradeDate: string;
  ticker: string;
  /** Signed share delta, formatted; `DASH` when null (a pure-cash event). */
  quantity: string;
  /** Signed cash impact with +/- and a ▲/▼ direction marker. */
  amount: { text: string; direction: "up" | "down" | "flat" };
  source: LedgerSource;
  /** Transfer-in with no acquisition record → surface a "basis?" badge. */
  basisUnknown: boolean;
  /** Tombstoned / cancelled row → render muted + struck-through. */
  voided: boolean;
};

/** Format a signed share quantity. `null` → `DASH`. A leading `+` makes a
 *  shares-in delta read as cleanly as the signed cash amount. */
function formatSignedQuantity(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  const fixed = Math.abs(value).toFixed(4).replace(/\.?0+$/, "");
  if (value > 0) return `+${fixed}`;
  if (value < 0) return `-${fixed}`;
  return fixed;
}

/** Map a persisted `LedgerRow` to its render-ready row model. Pure — exported
 *  for the node-env spec (`test/ledger-row-model.spec.ts`). */
export function buildLedgerRowModel(row: LedgerRow): LedgerRowModel {
  return {
    id: row.id,
    type: TYPE_LABELS[row.type],
    tradeDate: row.tradeDate,
    ticker: row.ticker ?? DASH,
    quantity: formatSignedQuantity(row.quantity),
    amount: formatSignedMoney(row.amount, row.currency),
    source: row.source,
    basisUnknown: row.basisUnknown !== null,
    voided: row.voidedAt !== null,
  };
}
