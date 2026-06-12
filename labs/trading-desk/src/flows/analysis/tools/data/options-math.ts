/**
 * Pure options-chain math.
 *
 * `get_options_chain` fetches a near-dated option chain snapshot and reduces it
 * to a handful of derivatives signals. These functions hold the only judgment in
 * the tool — how the at-the-money strike is located, how the 25-delta skew is
 * read, where the IV term-structure flat band sits — so they live in their own
 * pure, unit-tested module rather than inline in the provider. No IO, no fetch.
 *
 * Every function returns `null` on insufficient data (no contracts, no finite
 * IV, a side of the skew missing) rather than a fabricated 0 — a missing signal
 * and a zero signal are different things for analyst reasoning (BP-020).
 */

/** One normalized option contract. Greeks / IV / OI are nullable because the
 *  provider does not always populate them (illiquid strikes, stale snapshots). */
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

/** Distinct expirations present in the chain, ascending. Empty when none. */
export function distinctExpiries(contracts: readonly OptionContract[]): string[] {
  return Array.from(new Set(contracts.map((c) => c.expiry))).sort();
}

/**
 * At-the-money implied vol for a single expiry: the mean IV of the contracts at
 * the strike nearest `spot`. Averages the call and put when both price at that
 * strike. `null` when no contract on the expiry carries a finite IV, or `spot`
 * is not finite.
 */
export function atmIv(
  contracts: readonly OptionContract[],
  spot: number | null,
  expiry: string,
): number | null {
  if (spot === null || !Number.isFinite(spot)) return null;
  const withIv = contracts.filter(
    (c) => c.expiry === expiry && c.iv !== null && Number.isFinite(c.iv),
  );
  if (withIv.length === 0) return null;
  const nearestStrike = withIv.reduce((best, c) =>
    Math.abs(c.strike - spot) < Math.abs(best.strike - spot) ? c : best,
  ).strike;
  const atTheMoney = withIv.filter((c) => c.strike === nearestStrike);
  const mean =
    atTheMoney.reduce((sum, c) => sum + (c.iv as number), 0) / atTheMoney.length;
  return mean;
}

/**
 * Classify an IV term-structure slope (far ATM IV minus near ATM IV). Inside
 * ±deadband is "flat"; positive (deferred vol richer) is "contango"; negative is
 * "backwardation". `null` slope (only one expiry) → `null`.
 */
export function classifyTermStructure(
  slope: number | null,
  deadband: number,
): "contango" | "flat" | "backwardation" | null {
  if (slope === null || !Number.isFinite(slope)) return null;
  if (slope > deadband) return "contango";
  if (slope < -deadband) return "backwardation";
  return "flat";
}

/**
 * 25-delta skew on one expiry: the IV of the put nearest −0.25 delta minus the
 * IV of the call nearest +0.25 delta. Positive = downside puts richer than
 * upside calls (a fear premium). `null` when either wing lacks a contract with
 * both a finite delta and a finite IV.
 */
export function skew25Delta(
  contracts: readonly OptionContract[],
  expiry: string,
): number | null {
  const usable = contracts.filter(
    (c) =>
      c.expiry === expiry &&
      c.iv !== null &&
      Number.isFinite(c.iv) &&
      c.delta !== null &&
      Number.isFinite(c.delta),
  );
  const nearestToDelta = (
    pool: OptionContract[],
    target: number,
  ): OptionContract | null =>
    pool.length === 0
      ? null
      : pool.reduce((best, c) =>
          Math.abs((c.delta as number) - target) <
          Math.abs((best.delta as number) - target)
            ? c
            : best,
        );
  const put = nearestToDelta(
    usable.filter((c) => c.type === "put"),
    -0.25,
  );
  const call = nearestToDelta(
    usable.filter((c) => c.type === "call"),
    0.25,
  );
  if (put === null || call === null) return null;
  return (put.iv as number) - (call.iv as number);
}

/**
 * Put/call open-interest ratio across the whole fetched chain: total put OI over
 * total call OI. `null` when call OI sums to 0 (can't divide) or no contract
 * carries OI.
 */
export function putCallOiRatio(contracts: readonly OptionContract[]): number | null {
  const sumOi = (type: "call" | "put"): number =>
    contracts
      .filter((c) => c.type === type && c.openInterest !== null)
      .reduce((sum, c) => sum + (c.openInterest as number), 0);
  const callOi = sumOi("call");
  const putOi = sumOi("put");
  if (callOi <= 0) return null;
  return putOi / callOi;
}

/** Sum a nullable numeric field across the chain. `null` when no contract
 *  carries the field (so an absent total stays honest, not a real 0). */
export function sumField(
  contracts: readonly OptionContract[],
  field: "openInterest" | "volume",
): number | null {
  const present = contracts.filter((c) => c[field] !== null);
  if (present.length === 0) return null;
  return present.reduce((sum, c) => sum + (c[field] as number), 0);
}
