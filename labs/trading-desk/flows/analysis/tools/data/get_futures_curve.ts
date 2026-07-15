/**
 * Benchmark futures curve (Massive / Polygon) — the Macro Analyst's cross-asset
 * positioning lane, and the honest realization of the "futures/COT positioning"
 * seam `get_cross_asset_flow` documented as a follow-up. A fixed basket of the
 * most macro-relevant US futures, each reduced (via the pure `futures-math`
 * functions) to a front-month level, a session change, a front-vs-next spread
 * with its contango/backwardation read, and a composite cross-asset `riskTone`.
 *
 * Massive is the only source (no fallback chain): the desk has no other futures
 * provider. Per-product failures degrade to null fields (the basket still
 * returns what priced), mirroring `get_cross_asset_flow`'s per-leg degrade. A
 * missing key or a fully unpriced basket → `source: "unavailable"` (BP-020).
 */
import { handler } from "@flow-state-dev/core";
import { mapLimit } from "@/lib/concurrency";
import { resolveToolPayload } from "../runtime/resolve";
import { fetchFuturesFrontNext, hasMassiveKey } from "@/lib/providers/massive";
import {
  changePct,
  classifyTermStructure,
  frontNextSpreadPct,
  riskTone,
  type FuturesAssetClass,
} from "./futures-math";
import { emptyPayload } from "../empty-payloads";
import {
  toolInputSchemas,
  toolOutputSchemas,
  type ToolInput,
  type ToolOutput,
} from "../schemas";

/** The benchmark basket: equity-index (risk), energy + metal (inflation /
 *  risk-off), and rates. Five products keep the call count and prompt size
 *  bounded; extending is a one-line edit. */
const FUTURES_BASKET: ReadonlyArray<{
  code: string;
  name: string;
  assetClass: FuturesAssetClass;
}> = [
  { code: "ES", name: "E-mini S&P 500", assetClass: "equity-index" },
  { code: "NQ", name: "E-mini Nasdaq 100", assetClass: "equity-index" },
  { code: "CL", name: "WTI Crude Oil", assetClass: "energy" },
  { code: "GC", name: "Gold", assetClass: "metal" },
  { code: "ZN", name: "10-Year T-Note", assetClass: "rates" },
];

/** Max simultaneous Massive futures lookups — each product is contracts + 1–2
 *  aggregates calls, so keep the fan-out modest. */
const FUTURES_CONCURRENCY = 3;
/** A front-vs-next spread inside ±0.1% is a flat curve, not contango. */
const FUTURES_TERM_DEADBAND = 0.001;
/** A composite (equity − gold) move inside ±0.2% is a neutral risk tone. */
const RISK_TONE_DEADBAND = 0.002;

async function fetchLive(
  input: ToolInput<"get_futures_curve">,
): Promise<ToolOutput<"get_futures_curve">> {
  const products = await mapLimit(FUTURES_BASKET, FUTURES_CONCURRENCY, async (p) => {
    const base = {
      productCode: p.code,
      name: p.name,
      assetClass: p.assetClass,
    };
    try {
      const { front, next } = await fetchFuturesFrontNext(p.code);
      const sessionChange = changePct(front?.last ?? null, front?.priorClose ?? null);
      const spread = frontNextSpreadPct(front?.last ?? null, next?.last ?? null);
      return {
        ...base,
        frontContract: front?.ticker ?? null,
        lastPrice: front?.last ?? null,
        changePct: sessionChange,
        nextContract: next?.ticker ?? null,
        frontNextSpreadPct: spread,
        termStructure: classifyTermStructure(spread, FUTURES_TERM_DEADBAND),
      };
    } catch {
      return {
        ...base,
        frontContract: null,
        lastPrice: null,
        changePct: null,
        nextContract: null,
        frontNextSpreadPct: null,
        termStructure: null,
      };
    }
  });

  if (!products.some((p) => p.lastPrice !== null)) {
    return emptyPayload("get_futures_curve", input);
  }

  return {
    source: "massive",
    asOf: input.date,
    products,
    riskTone: riskTone(
      products.map((p) => ({ assetClass: p.assetClass, changePct: p.changePct })),
      RISK_TONE_DEADBAND,
    ),
  };
}

export const get_futures_curve = handler({
  name: "get_futures_curve",
  description:
    "Benchmark futures curve (Massive): front-month levels and session change " +
    "for ES/NQ/CL/GC/ZN, contango/backwardation, and a composite risk tone.",
  inputSchema: toolInputSchemas.get_futures_curve,
  outputSchema: toolOutputSchemas.get_futures_curve,
  execute: async (input, ctx) => {
    return resolveToolPayload("get_futures_curve", input, ctx, async () => {
      if (!hasMassiveKey()) return emptyPayload("get_futures_curve", input);
      try {
        return await fetchLive(input);
      } catch {
        return emptyPayload("get_futures_curve", input);
      }
    });
  },
});
