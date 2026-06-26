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
 *  - Honest skips: corporate actions naive FIFO can't honor (`SPLIT`,
 *    `RETOFCAP`, `CLOSUREOPT`) are surfaced in `skipped`, not fed to the lot
 *    math where they would corrupt basis. Mergers/spin-offs are not distinct
 *    OFX aggregates — they arrive as `TRANSFER` and land as basis-unknown
 *    transfers, which is honest.
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
 *  date part and format ISO `YYYY-MM-DD`; null if it isn't 8 leading digits. */
function ofxDateToIso(value: unknown): string | null {
  const s = str(value);
  if (s === null) return null;
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
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
 *  caller-canonical sign already computed by the caller. */
function baseEvent(
  ctx: Ctx,
  invtran: OfxNode | null,
  fields: {
    type: LedgerEventInput["type"];
    ticker: string | null;
    quantity: number | null;
    unitPrice: number | null;
    amount: number;
    fee: number | null;
    basisUnknown: string | null;
    externalIdSuffix?: string;
  },
): FileLedgerEvent {
  const fitid = invtran ? str(invtran.FITID) : null;
  const externalId =
    fitid === null ? null : `${fitid}${fields.externalIdSuffix ?? ""}`;
  return {
    type: fields.type,
    tradeDate: ofxDateToIso(invtran?.DTTRADE ?? invtran?.DTPOSTED) ?? "1970-01-01",
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
  };
}

/** BUY* aggregates → a canonical buy (+quantity, −amount). */
function handleBuy(ctx: Ctx, agg: OfxNode): void {
  const buy = obj(agg.INVBUY);
  if (buy === null) return;
  const invtran = obj(buy.INVTRAN);
  const ticker = resolveTicker(ctx, obj(buy.SECID));
  const units = Math.abs(num(buy.UNITS) ?? 0);
  const unitPrice = num(buy.UNITPRICE);
  const total = num(buy.TOTAL);
  const fee = feeOf(buy);
  if (total === null && unitPrice === null) {
    ctx.warnings.push(
      `Buy of ${ticker ?? "a security"} has no price or total — its lot has unknown cost basis.`,
    );
  }
  ctx.events.push(
    baseEvent(ctx, invtran, {
      type: "buy",
      ticker,
      quantity: units,
      unitPrice: unitPrice === null ? null : Math.abs(unitPrice),
      // OFX `TOTAL` is net of commission/fees; when it's absent, fold the fee
      // back in so `amount` means the same all-in cash either way (the
      // fingerprint keys on `amount`, so the two paths must agree for dedup).
      amount: total === null ? -(units * (unitPrice ?? 0) + (fee ?? 0)) : -Math.abs(total),
      fee,
      basisUnknown: null,
    }),
  );
}

/** SELL* aggregates → a canonical sell (−quantity, +amount). */
function handleSell(ctx: Ctx, agg: OfxNode): void {
  const sell = obj(agg.INVSELL);
  if (sell === null) return;
  const invtran = obj(sell.INVTRAN);
  const ticker = resolveTicker(ctx, obj(sell.SECID));
  const units = Math.abs(num(sell.UNITS) ?? 0);
  const unitPrice = num(sell.UNITPRICE);
  const total = num(sell.TOTAL);
  const fee = feeOf(sell);
  ctx.events.push(
    baseEvent(ctx, invtran, {
      type: "sell",
      ticker,
      quantity: -units,
      unitPrice: unitPrice === null ? null : Math.abs(unitPrice),
      // All-in proceeds: when `TOTAL` is absent, net the fee out (it's already
      // netted into `TOTAL` when present) so both paths agree for dedup.
      amount: total === null ? units * (unitPrice ?? 0) - (fee ?? 0) : Math.abs(total),
      fee,
      basisUnknown: null,
    }),
  );
}

/** INCOME → dividend (DIV / capital gains) or interest, +amount, no shares. */
function handleIncome(ctx: Ctx, agg: OfxNode): void {
  const invtran = obj(agg.INVTRAN);
  const ticker = resolveTicker(ctx, obj(agg.SECID));
  const incomeType = str(agg.INCOMETYPE);
  const type = incomeType === "INTEREST" ? "interest" : "dividend";
  ctx.events.push(
    baseEvent(ctx, invtran, {
      type,
      ticker,
      quantity: null,
      unitPrice: null,
      // Preserve the file's sign: income is normally positive (cash in), but a
      // dividend reversal / correction is a real negative — don't `abs` it into
      // a phantom positive dividend.
      amount: num(agg.TOTAL) ?? 0,
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
  const ticker = resolveTicker(ctx, obj(agg.SECID));
  const units = Math.abs(num(agg.UNITS) ?? 0);
  const unitPrice = num(agg.UNITPRICE);
  const total = Math.abs(num(agg.TOTAL) ?? 0);
  ctx.events.push(
    baseEvent(ctx, invtran, {
      type: "dividend",
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
      ticker,
      quantity: units,
      unitPrice: unitPrice === null ? null : Math.abs(unitPrice),
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
  const ticker = resolveTicker(ctx, obj(agg.SECID));
  const tferAction = str(agg.TFERACTION); // IN | OUT (TRANSFER only)
  const rawUnits = Math.abs(num(agg.UNITS) ?? 0);
  const isOut = tferAction === "OUT";
  const quantity = isOut ? -rawUnits : rawUnits;
  ctx.events.push(
    baseEvent(ctx, invtran, {
      type: "transfer",
      ticker,
      quantity,
      unitPrice: null,
      amount: 0,
      fee: null,
      basisUnknown:
        quantity > 0
          ? `transferred in via ${kind}; no acquisition record in file`
          : null,
    }),
  );
}

/** MARGININTEREST / INVEXPENSE → a fee (−amount, no shares). */
function handleCashCharge(ctx: Ctx, agg: OfxNode): void {
  const invtran = obj(agg.INVTRAN);
  ctx.events.push(
    baseEvent(ctx, invtran, {
      type: "fee",
      ticker: resolveTicker(ctx, obj(agg.SECID)),
      quantity: null,
      unitPrice: null,
      amount: -Math.abs(num(agg.TOTAL) ?? 0),
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
  const amount = num(stmt.TRNAMT) ?? 0;
  const trnType = (str(stmt.TRNTYPE) ?? "").toUpperCase();
  let type: LedgerEventInput["type"];
  if (trnType === "INT") type = "interest";
  else if (trnType === "DIV") type = "dividend";
  else if (trnType === "FEE" || trnType === "SRVCHG") type = "fee";
  else if (amount >= 0) type = "deposit";
  else type = "withdrawal";
  const fitid = str(stmt.FITID);
  ctx.events.push({
    type,
    tradeDate: ofxDateToIso(stmt.DTPOSTED) ?? "1970-01-01",
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
  });
}

/** Corporate actions naive FIFO cannot honor in v1 — recorded as skipped (with
 *  a warning) so the user can enter them manually, never fed to the lot math. */
function handleSkip(ctx: Ctx, agg: OfxNode, kind: string): void {
  const invtran = obj(agg.INVTRAN);
  const secid = obj(agg.SECID);
  const uniqueId = secid ? str(secid.UNIQUEID) : null;
  const date = ofxDateToIso(invtran?.DTTRADE) ?? "unknown date";
  const security = uniqueId ?? "unknown security";
  ctx.skipped.push({
    kind,
    reason: `${kind} on ${security} (${date}) not imported — record manually; v1 does not adjust basis for corporate actions`,
  });
}

/** The aggregate dispatch table. A tag absent here is reported as an unhandled
 *  warning rather than silently dropped. */
const HANDLERS: Record<string, (ctx: Ctx, agg: OfxNode) => void> = {
  BUYSTOCK: handleBuy,
  BUYMF: handleBuy,
  BUYOPT: handleBuy,
  BUYDEBT: handleBuy,
  BUYOTHER: handleBuy,
  SELLSTOCK: handleSell,
  SELLMF: handleSell,
  SELLOPT: handleSell,
  SELLDEBT: handleSell,
  SELLOTHER: handleSell,
  INCOME: handleIncome,
  REINVEST: handleReinvest,
  TRANSFER: (ctx, agg) => handleTransfer(ctx, agg, "TRANSFER"),
  JRNLSEC: (ctx, agg) => handleTransfer(ctx, agg, "JRNLSEC"),
  MARGININTEREST: handleCashCharge,
  INVEXPENSE: handleCashCharge,
  INVBANKTRAN: handleBankTran,
  SPLIT: (ctx, agg) => handleSkip(ctx, agg, "SPLIT"),
  RETOFCAP: (ctx, agg) => handleSkip(ctx, agg, "RETOFCAP"),
  CLOSUREOPT: (ctx, agg) => handleSkip(ctx, agg, "CLOSUREOPT"),
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
  const parsed = (await parseOfx(content)) as { OFX?: OfxNode };
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

  if (fileAccountIds.length === 0) {
    ctx.warnings.push(
      "No investment statement (<INVSTMTRS>) found — this OFX file has no investment transactions to import.",
    );
  } else if (fileAccountIds.length > 1) {
    // The file spans multiple brokerage accounts, but import targets ONE chosen
    // account — every transaction lands there. Surface it (the caller should
    // import a per-account export) rather than silently merging two accounts'
    // histories (and basis) into one. Per-account mapping is a follow-up.
    ctx.warnings.push(
      `This file contains ${fileAccountIds.length} accounts (${fileAccountIds.join(", ")}). ` +
        "All transactions were imported into the one selected account — import a per-account file to keep them separate.",
    );
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
