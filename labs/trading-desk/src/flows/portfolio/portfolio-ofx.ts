/**
 * Pure, browser-safe OFX-family parser (FIX-775) — one parser for QFX, QBO, and
 * raw OFX (the issue's one-parser hypothesis).
 *
 * No `@flow-state-dev/core` import, no `node:*` — it runs identically in the
 * import dialog's client-side preview and in the server-side
 * `importTransactions` action (the `portfolio-csv.ts` precedent). `ofx-js` (a
 * zero-dependency tokenizer) owns the genuinely fiddly part — the OFX 1.x SGML
 * (unclosed leaf tags) vs 2.x XML branch — and returns a nested object. This
 * module owns what no library does: the *semantic* mapping — walking
 * `INVTRANLIST`, normalizing each typed aggregate into the canonical
 * `LedgerEventInput`, and joining each transaction's `SECID` to the file's
 * `SECLIST` to recover a ticker.
 *
 * Design tenets (mirroring the CSV parser's real-money trust gates):
 *  - Deterministic, side-effect-free, no DB or resource access.
 *  - Honest signs: every event is normalized to the FIX-774 caller-canonical
 *    convention (buy = +quantity / −amount; sell = −quantity / +amount), by the
 *    aggregate's TYPE, so the same trade fingerprints identically no matter the
 *    file's own sign convention — this is what makes cross-source dedup work.
 *  - Honest gaps: a security that carries no ticker (CUSIP-only, e.g. Fidelity)
 *    is recorded keyed by its CUSIP and surfaced in `unresolvedSecurities`,
 *    never silently dropped. A transfer-in with no acquisition price is a
 *    `basisUnknown` lot, never a zero.
 *  - Stock splits are ingested as a first-class `split` event (FIX-876) that
 *    `deriveLots` rebases open lots by — no longer skipped. The remaining
 *    corporate actions naive FIFO can't honor (`RETOFCAP`, `CLOSUREOPT`) are
 *    still surfaced in `skipped`, not fed to the lot math where they would
 *    corrupt basis. Mergers/spin-offs are not distinct OFX aggregates — they
 *    arrive as `TRANSFER` and land as basis-unknown transfers, which is honest.
 *
 * The parser does NOT set `accountId` or `source`: OFX account ids don't map to
 * our account ids, so the `importTransactions` action injects the user-chosen
 * `accountId` and fixes `source: "file"` (mirroring how `recordLedgerEvent`
 * fixes `source: "manual"`).
 */
import { parse as parseOfx } from "ofx-js";
import type { LedgerEventInput } from "./ledger-schema";
import type {
  SkippedAggregate,
  UnresolvedSecurity,
} from "./transaction-import-schema";

/** A parsed ledger event minus the two fields only the action can set:
 *  `accountId` (the user's target account) and `source` (always `"file"`). */
export type FileLedgerEvent = Omit<LedgerEventInput, "accountId" | "source">;

// The report shapes are owned by the (zod) report schema leaf so the parser and
// the import report can't drift on the fields the dialog renders.
export type { SkippedAggregate, UnresolvedSecurity };

/** The parse result: the canonical events to ingest plus the diagnostics the
 *  import report surfaces. */
export type OfxParseResult = {
  events: FileLedgerEvent[];
  unresolvedSecurities: UnresolvedSecurity[];
  skipped: SkippedAggregate[];
  warnings: string[];
};

/** A loosely-typed OFX node. `ofx-js` returns leaf values as strings and nests
 *  aggregates as objects; a repeated tag becomes an array. We walk it
 *  defensively rather than trust the library's generated types, which don't
 *  cover every aggregate (e.g. `INVBANKTRAN`). */
type OfxNode = Record<string, unknown>;

/** Coerce a possibly-absent, possibly-single OFX child into an array. A single
 *  aggregate is `{...}`; two or more of the same tag are `[{...}, {...}]`. */
function asArray(value: unknown): OfxNode[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]) as OfxNode[];
}

/** Read a leaf string (OFX leaf values are strings), trimmed; null if absent. */
function str(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

/** Read a child object (an aggregate), or null if absent / not an object. */
function obj(value: unknown): OfxNode | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as OfxNode)
    : null;
}

/** Parse an OFX numeric leaf to a finite JS number, or null. A non-finite value
 *  (a malformed field) becomes null rather than poisoning downstream math. */
function num(value: unknown): number | null {
  const s = str(value);
  if (s === null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** An OFX datetime is `YYYYMMDD` optionally followed by time/timezone. Take the
 *  date part and format ISO `YYYY-MM-DD`; null if it isn't 8 leading digits OR
 *  isn't a real calendar date. A malformed-but-8-digit date like `20261340`
 *  must NOT pass — the ledger date column would reject it and fail the whole
 *  batch insert, so reject it here and let the caller skip just that row. */
function ofxDateToIso(value: unknown): string | null {
  const s = str(value);
  if (s === null) return null;
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(s);
  if (m === null) return null;
  const [, y, mo, d] = m;
  const iso = `${y}-${mo}-${d}`;
  // Round-trip through Date to reject impossible months/days (e.g. month 13,
  // day 40, Feb 30) — `getUTC*` rolls an out-of-range value over, so a mismatch
  // means the input wasn't a real date.
  const dt = new Date(`${iso}T00:00:00Z`);
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCFullYear() !== Number(y) ||
    dt.getUTCMonth() + 1 !== Number(mo) ||
    dt.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  return iso;
}

/** The transaction's trade date, preferring `DTTRADE`, falling back to
 *  `DTPOSTED`. Null when neither is a usable date — the caller skips the event
 *  rather than dating it to the epoch (a fake date would corrupt FIFO order and
 *  the acquired-date). */
function tradeDateOf(invtran: OfxNode | null): string | null {
  // Fall back on `DTPOSTED` when `DTTRADE` is absent OR present-but-unparseable
  // (blank / calendar-invalid). A `??` on the raw values wouldn't fall back for a
  // present-but-bad `DTTRADE`, dropping a row that has a usable posted date.
  return ofxDateToIso(invtran?.DTTRADE) ?? ofxDateToIso(invtran?.DTPOSTED);
}

/** Read a transaction's `FITID`, treating a blank/absent id as null. An empty
 *  `<FITID>` must NOT become `externalId: ""` — every blank-id row in the same
 *  account/file would then collide on the `(account, source, external_id)` dedup
 *  and drop unrelated trades. Null lets those rows dedup by fingerprint instead. */
function fitidOf(node: OfxNode | null): string | null {
  const id = node ? str(node.FITID) : null;
  return id === null || id === "" ? null : id;
}

/** Sum the optional `COMMISSION` + `FEES` legs into a single fee, or null when
 *  neither is present. */
function feeOf(node: OfxNode): number | null {
  const commission = num(node.COMMISSION);
  const fees = num(node.FEES);
  if (commission === null && fees === null) return null;
  return (commission ?? 0) + (fees ?? 0);
}

/** A `SECID` → display map built from the file's `SECLIST`. */
type SecMap = Map<string, { ticker: string | null; name: string | null }>;

/** Walk every `*INFO` aggregate under each `SECLIST` and index its `SECINFO` by
 *  `UNIQUEID` (the CUSIP), capturing the optional `TICKER` and `SECNAME`. */
function buildSecMap(root: OfxNode): SecMap {
  const map: SecMap = new Map();
  const infoTags = ["STOCKINFO", "MFINFO", "OPTINFO", "DEBTINFO", "OTHERINFO"];
  for (const msgset of asArray(root.SECLISTMSGSRSV1)) {
    for (const seclist of asArray(msgset.SECLIST)) {
      for (const tag of infoTags) {
        for (const info of asArray(seclist[tag])) {
          const secinfo = obj(info.SECINFO);
          if (secinfo === null) continue;
          const secid = obj(secinfo.SECID);
          const uniqueId = secid ? str(secid.UNIQUEID) : null;
          if (uniqueId === null) continue;
          const ticker = str(secinfo.TICKER);
          map.set(uniqueId, {
            ticker: ticker ? ticker.toUpperCase() : null,
            name: str(secinfo.SECNAME),
          });
        }
      }
    }
  }
  return map;
}

/** The mutable accumulator threaded through the per-aggregate handlers. */
type Ctx = {
  events: FileLedgerEvent[];
  unresolved: Map<string, string | null>; // cusip → name (deduped)
  skipped: SkippedAggregate[];
  warnings: string[];
  secMap: SecMap;
  currency: string;
};

/**
 * Resolve a transaction's security to a canonical ticker. Returns the
 * `SECLIST` ticker when present; otherwise falls back to the CUSIP as the
 * keying identifier AND records it as unresolved (so the report can prompt a
 * manual mapping — a CUSIP-keyed event won't attach to a ticker-keyed holding
 * until then). Returns null when the aggregate carries no `SECID` at all
 * (it shouldn't, for a security transaction).
 */
function resolveTicker(ctx: Ctx, secid: OfxNode | null): string | null {
  const uniqueId = secid ? str(secid.UNIQUEID) : null;
  if (uniqueId === null) return null;
  const hit = ctx.secMap.get(uniqueId);
  if (hit?.ticker) return hit.ticker;
  if (!ctx.unresolved.has(uniqueId)) ctx.unresolved.set(uniqueId, hit?.name ?? null);
  return uniqueId.toUpperCase();
}

/** Build a canonical event from the common `INVTRAN` fields, applying the
 *  caller-canonical sign already computed by the caller. The caller resolves +
 *  validates `tradeDate` first (skipping the event when it can't), so this never
 *  fabricates a date. */
function baseEvent(
  ctx: Ctx,
  invtran: OfxNode | null,
  fields: {
    type: LedgerEventInput["type"];
    tradeDate: string;
    ticker: string | null;
    quantity: number | null;
    unitPrice: number | null;
    amount: number;
    fee: number | null;
    basisUnknown: string | null;
    proceedsUnknown?: string | null;
    externalIdSuffix?: string;
  },
): FileLedgerEvent {
  const fitid = fitidOf(invtran);
  const externalId =
    fitid === null ? null : `${fitid}${fields.externalIdSuffix ?? ""}`;
  return {
    type: fields.type,
    tradeDate: fields.tradeDate,
    settleDate: ofxDateToIso(invtran?.DTSETTLE),
    ticker: fields.ticker,
    quantity: fields.quantity,
    unitPrice: fields.unitPrice,
    amount: fields.amount,
    fee: fields.fee,
    currency: ctx.currency,
    externalId,
    description: invtran ? str(invtran.MEMO) : null,
    basisUnknown: fields.basisUnknown,
    proceedsUnknown: fields.proceedsUnknown ?? null,
  };
}

/** Resolve a security transaction's trade date, or skip-with-warning when the
 *  file gives no usable date (never date it to the epoch — a fake date corrupts
 *  FIFO order and the acquired-date). Returns null to tell the caller to bail. */
function requireTradeDate(ctx: Ctx, invtran: OfxNode | null, kind: string): string | null {
  const date = tradeDateOf(invtran);
  if (date === null) {
    const fitid = fitidOf(invtran);
    ctx.warnings.push(
      `A ${kind} transaction${fitid ? ` (${fitid})` : ""} has no usable trade date — skipped.`,
    );
  }
  return date;
}

/** A share-moving aggregate needs both a security (`SECID`) and a non-zero unit
 *  count to form a lot. A row missing either is malformed — skip-with-warning
 *  rather than record a cash amount with no lot, which would look like a
 *  successful import that reconstructed nothing. */
function hasShareLegs(ctx: Ctx, ticker: string | null, units: number, kind: string): boolean {
  if (ticker === null || units === 0) {
    ctx.warnings.push(`A ${kind} transaction is missing its security or unit count — skipped.`);
    return false;
  }
  return true;
}

/** BUY* aggregates → a canonical buy (+quantity, −amount). */
function handleBuy(ctx: Ctx, agg: OfxNode): void {
  const buy = obj(agg.INVBUY);
  if (buy === null) return;
  // A buy-to-cover closes a short v1 never opened (short opens are skipped), so
  // booking it as a long buy would create a phantom long lot. Skip-with-warning.
  // (Options never reach here — `BUYOPT` is skipped wholesale; see `handleOptionSkip`.)
  if (str(agg.BUYTYPE) === "BUYTOCOVER") {
    ctx.warnings.push(
      "A buy-to-cover (closing a short) was skipped — v1 reconstructs long positions only; record it manually.",
    );
    return;
  }
  const invtran = obj(buy.INVTRAN);
  const tradeDate = requireTradeDate(ctx, invtran, "buy");
  if (tradeDate === null) return;
  const ticker = resolveTicker(ctx, obj(buy.SECID));
  const units = Math.abs(num(buy.UNITS) ?? 0);
  if (!hasShareLegs(ctx, ticker, units, "buy")) return;
  const unitPrice = num(buy.UNITPRICE);
  const total = num(buy.TOTAL);
  const fee = feeOf(buy);
  // No price AND no total → the lot's cost basis is genuinely unknown. Flag it
  // (so `deriveLots` records a null-cost lot) rather than letting it infer a
  // phantom cost from `amount / quantity` (which would be just the fee/share).
  const noCost = total === null && unitPrice === null;
  if (noCost) {
    ctx.warnings.push(
      `Buy of ${ticker ?? "a security"} has no price or total — its lot has unknown cost basis.`,
    );
  }
  // OFX `TOTAL` is net of commission/fees; when it's absent, fold the fee back in
  // so `amount` is the all-in cash either way (the fingerprint keys on `amount`,
  // so the two paths must agree for dedup).
  const amount = total === null ? -(units * (unitPrice ?? 0) + (fee ?? 0)) : -Math.abs(total);
  ctx.events.push(
    baseEvent(ctx, invtran, {
      type: "buy",
      tradeDate,
      ticker,
      quantity: units,
      // `unitPrice` is the cost-basis-per-share `deriveLots` reads, so it must be
      // the ALL-IN cost (execution price + commission/fees), not the raw
      // `UNITPRICE` — otherwise a commissioned buy understates basis by the
      // commission. `amount` already carries the all-in cash, so basis = |amount|/units.
      unitPrice: noCost ? null : Math.abs(amount) / units,
      amount,
      fee,
      basisUnknown: noCost ? "buy with no price or total in file" : null,
    }),
  );
}

/** SELL* aggregates → a canonical sell (−quantity, +amount). */
function handleSell(ctx: Ctx, agg: OfxNode): void {
  const sell = obj(agg.INVSELL);
  if (sell === null) return;
  // A short sale (`SELLTYPE=SELLSHORT`) opens a negative position v1's long-only
  // FIFO can't model (a naive long-sell is silently clamped away). Skip-with-
  // warning. (Options never reach here — `SELLOPT` is skipped wholesale.)
  if (str(agg.SELLTYPE) === "SELLSHORT") {
    ctx.warnings.push(
      "A short sale (SELLSHORT) was skipped — v1 reconstructs long positions only; record it manually.",
    );
    return;
  }
  const invtran = obj(sell.INVTRAN);
  const tradeDate = requireTradeDate(ctx, invtran, "sell");
  if (tradeDate === null) return;
  const ticker = resolveTicker(ctx, obj(sell.SECID));
  const units = Math.abs(num(sell.UNITS) ?? 0);
  if (!hasShareLegs(ctx, ticker, units, "sell")) return;
  const unitPrice = num(sell.UNITPRICE);
  const total = num(sell.TOTAL);
  const fee = feeOf(sell);
  // A sell with neither price nor total still removes shares (the disposal
  // happened), but its cash proceeds are unknown — record it (so FIFO consumes
  // the lot) and flag it `proceedsUnknown` so FIX-874's realized-gains derivation
  // nulls proceeds/gain and excludes it, rather than fabricating a full capital
  // loss off the placeholder `amount:0`. Distinct from a genuine $0 sale (which
  // leaves the marker null and derives a real loss).
  const proceedsUnknown =
    total === null && unitPrice === null
      ? "import-no-proceeds: sell had no TOTAL or UNITPRICE in the file"
      : null;
  if (proceedsUnknown !== null) {
    ctx.warnings.push(
      `Sell of ${ticker} has no price or total — recorded as a disposal with unknown proceeds (excluded from realized-gain totals until corrected).`,
    );
  }
  ctx.events.push(
    baseEvent(ctx, invtran, {
      type: "sell",
      tradeDate,
      ticker,
      quantity: -units,
      unitPrice: unitPrice === null ? null : Math.abs(unitPrice),
      // All-in proceeds: when `TOTAL` is absent, net the fee out (it's already
      // netted into `TOTAL` when present) so both paths agree for dedup. Floor at
      // 0: with neither TOTAL nor UNITPRICE the formula is just −fee, a negative
      // sell-proceeds (impossible canonically) that would also break cross-source
      // dedup — a Plaid event with the real positive proceeds fingerprints
      // differently, so both land and the lot is consumed twice.
      amount: total === null ? Math.max(0, units * (unitPrice ?? 0) - (fee ?? 0)) : Math.abs(total),
      fee,
      basisUnknown: null,
      proceedsUnknown,
    }),
  );
}

/** INCOME → dividend (DIV / capital gains) or interest, +amount, no shares. */
function handleIncome(ctx: Ctx, agg: OfxNode): void {
  const invtran = obj(agg.INVTRAN);
  const tradeDate = requireTradeDate(ctx, invtran, "income");
  if (tradeDate === null) return;
  const ticker = resolveTicker(ctx, obj(agg.SECID));
  const incomeType = str(agg.INCOMETYPE);
  const type = incomeType === "INTEREST" ? "interest" : "dividend";
  // A row with no `TOTAL` has no cash amount to record. Recording it as $0 would
  // understate dividend/interest history AND, if it carries a FITID, dedup away a
  // later corrected re-import on the `(source, external_id)` index — skip + warn.
  const amount = num(agg.TOTAL);
  if (amount === null) {
    const fitid = fitidOf(invtran);
    ctx.warnings.push(
      `An income transaction${fitid ? ` (${fitid})` : ""} has no amount (TOTAL) — skipped.`,
    );
    return;
  }
  ctx.events.push(
    baseEvent(ctx, invtran, {
      type,
      tradeDate,
      ticker,
      quantity: null,
      unitPrice: null,
      // Preserve the file's sign: income is normally positive (cash in), but a
      // dividend reversal / correction is a real negative — don't `abs` it into
      // a phantom positive dividend.
      amount,
      fee: null,
      basisUnknown: null,
    }),
  );
}

/** REINVEST (a DRIP) → TWO events: the income (a dividend, +amount) and the
 *  reinvested buy (+quantity, −amount, a new lot). Distinct external ids
 *  (`FITID` for the buy, `FITID:div` for the income) keep both stable across
 *  re-imports without colliding on the `(source, external_id)` index. */
function handleReinvest(ctx: Ctx, agg: OfxNode): void {
  const invtran = obj(agg.INVTRAN);
  const tradeDate = requireTradeDate(ctx, invtran, "reinvest");
  if (tradeDate === null) return;
  const ticker = resolveTicker(ctx, obj(agg.SECID));
  // A DRIP reversal/correction exports as REINVEST with NEGATIVE units (shares
  // removed). abs()-ing it (as the `units` line below does) would book a phantom
  // positive dividend + buy — growing shares and income instead of undoing them.
  // v1 doesn't model reversals (same stance as the negative-TOTAL note below), so
  // skip-with-warning rather than normalize the sign away.
  const signedUnits = num(agg.UNITS);
  if (signedUnits !== null && signedUnits < 0) {
    const fitid = fitidOf(invtran);
    ctx.warnings.push(
      `A reinvestment (DRIP) reversal${fitid ? ` (${fitid})` : ""} with negative units was skipped — v1 doesn't model DRIP reversals; record it manually.`,
    );
    return;
  }
  const units = Math.abs(signedUnits ?? 0);
  if (!hasShareLegs(ctx, ticker, units, "reinvest")) return;
  const unitPrice = num(agg.UNITPRICE);
  const rawTotal = num(agg.TOTAL);
  // With neither cash (`TOTAL`) nor price, the reinvested amount is genuinely
  // unknown — `units × 0` would persist a $0 dividend + $0 buy under this FITID
  // and dedup away a later corrected re-import. Skip-with-warning instead.
  if (rawTotal === null && unitPrice === null) {
    const fitid = fitidOf(invtran);
    ctx.warnings.push(
      `A reinvestment (DRIP)${fitid ? ` (${fitid})` : ""} has no amount or price — skipped.`,
    );
    return;
  }
  // OFX `TOTAL` is the reinvested cash; when absent, derive it from units ×
  // price (the buy/sell fallback) so the DRIP doesn't record a $0 reinvestment
  // and lose its fingerprint match against the same DRIP from another source.
  // `abs()` is deliberate here (unlike the INCOME path, which preserves the file
  // sign): a REINVEST always maps to a dividend (+cash) AND a reinvested buy
  // (−cash, +shares), and a reversal can't be split into a sensible pair — a
  // negative-TOTAL reversal would need a manual correction, not an auto-DRIP.
  const total = rawTotal !== null ? Math.abs(rawTotal) : units * (unitPrice ?? 0);
  // The income leg is interest for a reinvested bond/MMF distribution
  // (`INCOMETYPE=INTEREST`), dividend otherwise — same distinction as the plain
  // INCOME path, so reinvested interest isn't misclassified as a dividend.
  const incomeType = str(agg.INCOMETYPE) === "INTEREST" ? "interest" : "dividend";
  ctx.events.push(
    baseEvent(ctx, invtran, {
      type: incomeType,
      tradeDate,
      ticker,
      quantity: null,
      unitPrice: null,
      amount: total,
      fee: null,
      basisUnknown: null,
      externalIdSuffix: ":div",
    }),
    baseEvent(ctx, invtran, {
      type: "buy",
      tradeDate,
      ticker,
      quantity: units,
      // Basis-per-share is the reinvested cash spread over the units (all-in),
      // the same cost `deriveLots` reads — `total / units`, not the raw price.
      unitPrice: total / units,
      amount: -total,
      fee: null,
      basisUnknown: null,
    }),
  );
}

/** TRANSFER / JRNLSEC → a transfer; a transfer-IN carries no acquisition price,
 *  so it is flagged `basisUnknown` (a basis hole), never zero-cost. */
function handleTransfer(ctx: Ctx, agg: OfxNode, kind: string): void {
  const invtran = obj(agg.INVTRAN);
  const tradeDate = requireTradeDate(ctx, invtran, kind);
  if (tradeDate === null) return;
  const ticker = resolveTicker(ctx, obj(agg.SECID));
  const rawUnits = Math.abs(num(agg.UNITS) ?? 0);
  if (!hasShareLegs(ctx, ticker, rawUnits, kind)) return;
  // A short-position transfer (`POSTYPE=SHORT`) can't be modeled by long-only
  // FIFO — an incoming short would book a phantom long lot, an outgoing short
  // would consume an unrelated long lot. Skip-with-warning.
  if (str(agg.POSTYPE) === "SHORT") {
    ctx.warnings.push(
      `A ${kind} of a short position (POSTYPE=SHORT) was skipped — v1 reconstructs long positions only; record it manually.`,
    );
    return;
  }
  // Direction must be explicit. Defaulting a missing/malformed `TFERACTION` to
  // IN would turn a broker error on an OUTBOUND transfer into a phantom
  // incoming lot — skip-with-warning when it isn't a known IN/OUT.
  const tferAction = str(agg.TFERACTION);
  if (tferAction !== "IN" && tferAction !== "OUT") {
    ctx.warnings.push(
      `A ${kind} transaction has an unknown direction (TFERACTION=${tferAction ?? "missing"}) — skipped; record it manually.`,
    );
    return;
  }
  const quantity = tferAction === "OUT" ? -rawUnits : rawUnits;
  // Preserve a broker-supplied cost basis ONLY from `UNITPRICE`, which OFX
  // defines unambiguously as price-per-share. `AVGCOSTBASIS` is deliberately
  // NOT used: its unit convention is inconsistent across OFX versions/brokers
  // (a total dollar amount in some, per-share in others), and guessing wrong is
  // a silent order-of-magnitude basis error — the exact real-money footgun this
  // parser refuses. A transfer-in carrying only `AVGCOSTBASIS` (no `UNITPRICE`)
  // therefore stays basis-unknown (honest over silently-wrong), never zero.
  const transferUnitCost = num(agg.UNITPRICE);
  const hasBasis = quantity > 0 && transferUnitCost !== null;
  ctx.events.push(
    baseEvent(ctx, invtran, {
      type: "transfer",
      tradeDate,
      ticker,
      quantity,
      unitPrice: hasBasis ? Math.abs(transferUnitCost) : null,
      amount: 0,
      fee: null,
      basisUnknown:
        quantity > 0 && !hasBasis
          ? `transferred in via ${kind}; no acquisition cost in file`
          : null,
    }),
  );
}

/** MARGININTEREST / INVEXPENSE → a fee (−amount, no shares). */
function handleCashCharge(ctx: Ctx, agg: OfxNode): void {
  const invtran = obj(agg.INVTRAN);
  const tradeDate = requireTradeDate(ctx, invtran, "fee");
  if (tradeDate === null) return;
  // Same no-amount rule as income/cash-bank: a charge with no `TOTAL` is a $0
  // no-op that also blocks a later corrected re-import via the FITID index.
  const total = num(agg.TOTAL);
  if (total === null) {
    const fitid = fitidOf(invtran);
    ctx.warnings.push(
      `A fee transaction${fitid ? ` (${fitid})` : ""} has no amount (TOTAL) — skipped.`,
    );
    return;
  }
  ctx.events.push(
    baseEvent(ctx, invtran, {
      type: "fee",
      tradeDate,
      ticker: resolveTicker(ctx, obj(agg.SECID)),
      quantity: null,
      unitPrice: null,
      amount: -Math.abs(total),
      fee: null,
      basisUnknown: null,
    }),
  );
}

/** INVBANKTRAN wraps a bank `STMTTRN` (a cash movement in the investment
 *  account). Map its `TRNTYPE` to a cash event kind, preserving the signed
 *  `TRNAMT`. (`INVBANKTRAN` is not in `ofx-js`'s generated types — read via the
 *  same defensive accessors as everything else.) */
function handleBankTran(ctx: Ctx, agg: OfxNode): void {
  const stmt = obj(agg.STMTTRN);
  if (stmt === null) return;
  // A cash movement with no parseable `TRNAMT` is a $0 no-op (and, with a FITID,
  // would block a later corrected re-import via the external-id index) — and the
  // amount sign also decides deposit vs withdrawal, so a missing one isn't even
  // classifiable. Skip + warn rather than materialize it.
  const amount = num(stmt.TRNAMT);
  if (amount === null) {
    const id = fitidOf(stmt);
    ctx.warnings.push(
      `A cash (INVBANKTRAN) transaction${id ? ` (${id})` : ""} has no amount (TRNAMT) — skipped.`,
    );
    return;
  }
  const trnType = (str(stmt.TRNTYPE) ?? "").toUpperCase();
  let type: LedgerEventInput["type"];
  if (trnType === "INT") type = "interest";
  else if (trnType === "DIV") type = "dividend";
  else if (trnType === "FEE" || trnType === "SRVCHG") type = "fee";
  else if (amount >= 0) type = "deposit";
  else type = "withdrawal";
  const tradeDate = ofxDateToIso(stmt.DTPOSTED);
  if (tradeDate === null) {
    const id = fitidOf(stmt);
    ctx.warnings.push(
      `A cash (INVBANKTRAN) transaction${id ? ` (${id})` : ""} has no usable posted date — skipped.`,
    );
    return;
  }
  const fitid = fitidOf(stmt);
  ctx.events.push({
    type,
    tradeDate,
    settleDate: null,
    ticker: null,
    quantity: null,
    unitPrice: null,
    amount,
    fee: null,
    currency: ctx.currency,
    externalId: fitid,
    description: str(stmt.NAME) ?? str(stmt.MEMO),
    basisUnknown: null,
    proceedsUnknown: null,
  });
}

/** Resolve a SPLIT aggregate's ratio to a positive numerator/denominator.
 *  Prefers the explicit `NUMERATOR`/`DENOMINATOR` (OFX's clean split ratio, e.g.
 *  10/1), falling back to the holder's `NEWUNITS`/`OLDUNITS` share counts — which
 *  may be FRACTIONAL for a fractional-share account (their ratio is still exact).
 *  Returns null only when neither yields a positive pair — the caller then
 *  skips-with-warning rather than fabricate a ratio. */
function resolveSplitRatio(agg: OfxNode): { numerator: number; denominator: number } | null {
  const positive = (n: number | null): n is number => n !== null && n > 0;
  const numerator = num(agg.NUMERATOR);
  const denominator = num(agg.DENOMINATOR);
  if (positive(numerator) && positive(denominator)) return { numerator, denominator };
  // Fall back to the holder's before/after share counts. These may be FRACTIONAL
  // for a fractional-share account (e.g. 121.9346 → 12.19346 for a 10-for-1), so
  // accept any positive pair — the ratio `NEWUNITS / OLDUNITS` is exact regardless
  // of whether the raw counts are whole. Only a non-positive pair is unusable.
  const newUnits = num(agg.NEWUNITS);
  const oldUnits = num(agg.OLDUNITS);
  if (positive(newUnits) && positive(oldUnits)) {
    return { numerator: newUnits, denominator: oldUnits };
  }
  return null;
}

/** SPLIT → a first-class `split` ledger event (FIX-876) that `deriveLots`
 *  rebases the ticker's open lots by, instead of the old skip-with-warning. The
 *  ratio comes from `NUMERATOR`/`DENOMINATOR` (fallback `NEWUNITS`/`OLDUNITS`);
 *  an unresolvable ticker or a non-positive-integer ratio is skipped-with-warning
 *  (never a fabricated split). A `FRACCASH` cash-in-lieu leg is real money —
 *  surfaced as a separate cash row and warned, not dropped. */
function handleSplit(ctx: Ctx, agg: OfxNode): void {
  const invtran = obj(agg.INVTRAN);
  const tradeDate = requireTradeDate(ctx, invtran, "split");
  if (tradeDate === null) return;
  const ticker = resolveTicker(ctx, obj(agg.SECID));
  if (ticker === null) {
    ctx.warnings.push("A stock split with no identifiable security was skipped — record it manually.");
    return;
  }
  // Record the split when the ratio resolves; otherwise skip-with-warning. Either
  // way, DON'T early-return — the FRACCASH cash-in-lieu leg below is INDEPENDENT
  // real money and must be recorded even when the ratio is unusable.
  const ratio = resolveSplitRatio(agg);
  if (ratio === null) {
    ctx.warnings.push(
      `A stock split of ${ticker} had no usable ratio (numerator/denominator) — the split was skipped (record it manually); any cash-in-lieu is still recorded.`,
    );
  } else {
    ctx.events.push({
      ...baseEvent(ctx, invtran, {
        type: "split",
        tradeDate,
        ticker,
        quantity: null,
        unitPrice: null,
        amount: 0,
        fee: null,
        basisUnknown: null,
      }),
      attributes: { numerator: ratio.numerator, denominator: ratio.denominator },
    });
  }
  // Cash-in-lieu of a fractional share is real money — record it as a separate
  // cash row (a distinct external id so it doesn't collide with the split on the
  // dedup index) and warn. It is recorded as a `deposit`, NOT a `dividend`:
  // cash-in-lieu is disposal/sale proceeds, not dividend income, so a `dividend`
  // would inflate `getIncomeSummary`'s Dividends total. `deposit` lands the cash
  // without asserting income (cash-in-lieu SALE math is out of scope; this just
  // surfaces the money honestly). A zero/absent FRACCASH is no cash event.
  const fracCash = num(agg.FRACCASH);
  if (fracCash !== null && fracCash > 0) {
    ctx.events.push(
      baseEvent(ctx, invtran, {
        type: "deposit",
        tradeDate,
        ticker,
        quantity: null,
        unitPrice: null,
        amount: fracCash,
        fee: null,
        basisUnknown: null,
        externalIdSuffix: ":fraccash",
      }),
    );
    ctx.warnings.push(
      `Split of ${ticker} paid ${fracCash} cash-in-lieu of a fractional share — recorded as a cash (deposit) row, not dividend income (reclassify if needed).`,
    );
  }
}

/** Record an aggregate as skipped (with a reason) rather than feed it to the
 *  long-only FIFO lot math, where it would corrupt basis — corporate actions
 *  (no basis math in v1) and intra-account security journals (no net position
 *  effect for an account-level ledger). */
function handleSkip(ctx: Ctx, agg: OfxNode, kind: string, note: string): void {
  const invtran = obj(agg.INVTRAN);
  const secid = obj(agg.SECID);
  const uniqueId = secid ? str(secid.UNIQUEID) : null;
  const date = tradeDateOf(invtran) ?? "unknown date";
  const security = uniqueId ?? "unknown security";
  ctx.skipped.push({ kind, reason: `${kind} on ${security} (${date}) not imported — ${note}` });
}

/** Option trades (`BUYOPT` / `SELLOPT`) are NOT modeled in v1 and are surfaced
 *  in `skipped`, never recorded. Routing them through the equity path would store
 *  the per-share premium as basis and ignore the `SHPERCTRCT` contract multiplier
 *  (a ~100× basis error), and the short legs (sell-to-open / buy-to-close) can't
 *  be modeled by long-only FIFO. Proper option modeling is FIX-773. */
function handleOptionSkip(ctx: Ctx, agg: OfxNode, kind: string): void {
  const inner = obj(agg.INVBUY) ?? obj(agg.INVSELL);
  const invtran = inner ? obj(inner.INVTRAN) : null;
  const secid = inner ? obj(inner.SECID) : null;
  const uniqueId = secid ? str(secid.UNIQUEID) : null;
  const date = tradeDateOf(invtran) ?? "unknown date";
  ctx.skipped.push({
    kind,
    reason: `${kind} on ${uniqueId ?? "an option"} (${date}) not imported — options aren't modeled in v1 (contract multiplier / short legs are FIX-773); record it manually.`,
  });
}

const CORPORATE_ACTION_NOTE = "record manually; v1 does not adjust basis for corporate actions";

/** The aggregate dispatch table. A tag absent here is reported as an unhandled
 *  warning rather than silently dropped. */
const HANDLERS: Record<string, (ctx: Ctx, agg: OfxNode) => void> = {
  BUYSTOCK: handleBuy,
  BUYMF: handleBuy,
  BUYDEBT: handleBuy,
  BUYOTHER: handleBuy,
  SELLSTOCK: handleSell,
  SELLMF: handleSell,
  SELLDEBT: handleSell,
  SELLOTHER: handleSell,
  // Options are not modeled in v1 (FIX-773) — surfaced in `skipped`, never fed to
  // the equity path (which would 100×-misprice basis via the missing multiplier).
  BUYOPT: (ctx, agg) => handleOptionSkip(ctx, agg, "BUYOPT"),
  SELLOPT: (ctx, agg) => handleOptionSkip(ctx, agg, "SELLOPT"),
  INCOME: handleIncome,
  REINVEST: handleReinvest,
  TRANSFER: (ctx, agg) => handleTransfer(ctx, agg, "TRANSFER"),
  // A security journal moves shares between an account's own subaccounts
  // (e.g. cash <-> margin) — no net position change for this account-level
  // ledger, so skip rather than book a phantom transfer-in.
  JRNLSEC: (ctx, agg) =>
    handleSkip(
      ctx,
      agg,
      "JRNLSEC",
      "a security journal between subaccounts has no net effect on this account-level ledger",
    ),
  MARGININTEREST: handleCashCharge,
  INVEXPENSE: handleCashCharge,
  INVBANKTRAN: handleBankTran,
  // SPLIT is now ingested as a first-class `split` event (FIX-876) that rebases
  // open lots — no longer skipped. RETOFCAP/CLOSUREOPT stay skipped (their basis
  // math is out of scope).
  SPLIT: handleSplit,
  RETOFCAP: (ctx, agg) => handleSkip(ctx, agg, "RETOFCAP", CORPORATE_ACTION_NOTE),
  CLOSUREOPT: (ctx, agg) => handleSkip(ctx, agg, "CLOSUREOPT", CORPORATE_ACTION_NOTE),
};

/** The non-transaction children of `INVTRANLIST` (its bounds), never aggregates. */
const NON_TRANSACTION_TAGS = new Set(["DTSTART", "DTEND"]);

/**
 * Parse an OFX-family file (QFX / QBO / raw OFX, 1.x SGML or 2.x XML) into
 * canonical ledger events plus diagnostics. Throws only when the input is not
 * an OFX document at all (no `<OFX>` root) — the caller turns that into a parse
 * error; everything recoverable (an unknown aggregate, a CUSIP with no ticker)
 * is surfaced in the result rather than thrown.
 */
export async function parseOfxTransactions(content: string): Promise<OfxParseResult> {
  // `ofx-js` cannot tokenize an attributed root (`<OFX xmlns="...">`) — it fails
  // to split the header from the body and returns `OFX` as the string "undefined"
  // (no events). A real 2.x export may namespace the root, so strip attributes
  // from the opening `<OFX ...>` tag (only) before parsing. `\b` keeps this off
  // `<OFXHEADER>`/`<?OFX?>`; XML forbids a raw `>` in an attribute value, so
  // `[^>]*` stops at the tag close; the non-global replace touches only the root.
  const normalized = content.replace(/<OFX\b[^>]*>/i, "<OFX>");
  const parsed = (await parseOfx(normalized)) as { OFX?: OfxNode };
  const root = obj(parsed.OFX ?? null);
  if (root === null) {
    throw new Error("not a valid OFX file: missing <OFX> root");
  }

  const secMap = buildSecMap(root);
  const ctx: Ctx = {
    events: [],
    unresolved: new Map(),
    skipped: [],
    warnings: [],
    secMap,
    currency: "USD",
  };

  const fileAccountIds: string[] = [];
  for (const msgset of asArray(root.INVSTMTMSGSRSV1)) {
    for (const trnrs of asArray(msgset.INVSTMTTRNRS)) {
      const rs = obj(trnrs.INVSTMTRS);
      if (rs === null) continue;
      const acctId = str(obj(rs.INVACCTFROM)?.ACCTID ?? null);
      fileAccountIds.push(acctId ?? "unknown");
      ctx.currency = str(rs.CURDEF) ?? "USD";
      const list = obj(rs.INVTRANLIST);
      if (list === null) continue;
      for (const [tag, value] of Object.entries(list)) {
        if (NON_TRANSACTION_TAGS.has(tag)) continue;
        const handler = HANDLERS[tag];
        if (handler === undefined) {
          ctx.warnings.push(`Unhandled OFX transaction type "${tag}" — skipped.`);
          continue;
        }
        for (const agg of asArray(value)) handler(ctx, agg);
      }
    }
  }

  // De-dupe by ACCTID: a single brokerage account can legitimately arrive as
  // several `INVSTMTRS` blocks (split statement responses). Only DISTINCT source
  // accounts pose the cross-account-attribution / FITID-collision risk.
  const distinctAccountIds = [...new Set(fileAccountIds)];
  if (fileAccountIds.length === 0) {
    ctx.warnings.push(
      "No investment statement (<INVSTMTRS>) found — this OFX file has no investment transactions to import.",
    );
  } else if (distinctAccountIds.length > 1) {
    // The file spans multiple brokerage accounts, but import targets ONE chosen
    // account. Merging them would mis-attribute one account's basis to another
    // AND lose data: OFX FITIDs are only account-scoped, so the same FITID in two
    // source accounts would collide on the `(account, source, external_id)`
    // dedup and one would be dropped. Refuse the file rather than import a wrong,
    // partially-deduped merge — the user should export one account at a time.
    return {
      events: [],
      unresolvedSecurities: [],
      skipped: [],
      warnings: [
        `This file contains ${distinctAccountIds.length} accounts (${distinctAccountIds.join(", ")}). ` +
          "Nothing was imported — export and import one account at a time so each account's transactions (and cost basis) stay correctly attributed.",
      ],
    };
  }

  const unresolvedSecurities: UnresolvedSecurity[] = [...ctx.unresolved].map(
    ([cusip, name]) => ({ cusip, name }),
  );
  return {
    events: ctx.events,
    unresolvedSecurities,
    skipped: ctx.skipped,
    warnings: ctx.warnings,
  };
}
