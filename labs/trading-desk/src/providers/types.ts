/** Shared input and normalized data contracts for external provider clients. */

/** A provider request anchored to a point-in-time snapshot. */
export interface DatedProviderInput {
  date: string;
}

/** A provider request for one instrument at a point in time. */
export interface TickerDatedProviderInput extends DatedProviderInput {
  ticker: string;
}

/** Historical-price input accepted by market-data providers. */
export interface PriceHistoryProviderInput extends TickerDatedProviderInput {
  range?: string;
}

/** One normalized option contract returned by an options provider. */
export interface OptionContract {
  type: "call" | "put";
  strike: number;
  /** Expiration date, ISO `YYYY-MM-DD` (lexically sortable). */
  expiry: string;
  iv: number | null;
  delta: number | null;
  openInterest: number | null;
  volume: number | null;
}
