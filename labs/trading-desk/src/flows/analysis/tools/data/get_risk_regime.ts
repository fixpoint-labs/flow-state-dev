/**
 * Risk-regime handler: fetches 1yr prices for the name, SPY, and the
 * sector ETF, then computes beta, realized-vol regime, and correlation.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../runtime/cache";
import { resolveToolPayload } from "../runtime/resolve";
import { resolveSector } from "../../lib/sector-resolution";
import { fetchYahooChart } from "../providers/yahoo";
import { emptyPayload } from "../empty-payloads";
import {
  logReturns,
  realizedVolAnnualized,
  volRegimePercentile,
  olsBeta,
  rollingCorrelation,
  correlationRegime,
} from "./regime-math";
import {
  toolInputSchemas,
  toolOutputSchemas,
  type ToolInput,
  type ToolOutput,
} from "../schemas";

const BROAD_MARKET_TICKER = "SPY";
const SHORT_WINDOW = 21;
const CORR_WINDOW = 63;

async function fetchReturns(ticker: string, date: string): Promise<number[]> {
  const chart = await getOrFetch("get_price_history", { ticker, date, range: "1y" }, () =>
    fetchYahooChart({ ticker, date, range: "1y" }),
  );
  return logReturns(chart.bars.map((b) => b.close));
}

async function fetchLive(
  input: ToolInput<"get_risk_regime">,
): Promise<ToolOutput<"get_risk_regime">> {
  const { sectorEtf } = await resolveSector(input.ticker, input.date);

  let nameReturns: number[];
  try {
    nameReturns = await fetchReturns(input.ticker, input.date);
  } catch {
    return emptyPayload("get_risk_regime", input);
  }

  let spyReturns: number[] = [];
  try {
    spyReturns = await fetchReturns(BROAD_MARKET_TICKER, input.date);
  } catch {}

  let sectorReturns: number[] = [];
  if (sectorEtf) {
    try {
      sectorReturns = await fetchReturns(sectorEtf, input.date);
    } catch {}
  }

  const vol = realizedVolAnnualized(nameReturns);
  const regime = volRegimePercentile(nameReturns, SHORT_WINDOW);
  const marketBeta = spyReturns.length > 0 ? olsBeta(nameReturns, spyReturns) : null;
  const sectorBeta = sectorReturns.length > 0 ? olsBeta(nameReturns, sectorReturns) : null;
  const corrMarket = spyReturns.length > 0 ? rollingCorrelation(nameReturns, spyReturns, CORR_WINDOW) : null;
  const corrRegime = spyReturns.length > 0 ? correlationRegime(nameReturns, spyReturns, CORR_WINDOW) : null;

  return {
    source: nameReturns.length > 0 ? "yahoo" : "unavailable",
    ticker: input.ticker,
    asOf: input.date,
    betaMarket: marketBeta ? Math.round(marketBeta.beta * 100) / 100 : null,
    betaSector: sectorBeta ? Math.round(sectorBeta.beta * 100) / 100 : null,
    rSquared: marketBeta ? Math.round(marketBeta.rSquared * 100) / 100 : null,
    realizedVolAnnualized: vol != null ? Math.round(vol * 10000) / 10000 : null,
    volRegime: regime?.regime ?? null,
    volPercentile: regime?.percentile ?? null,
    correlationMarket: corrMarket != null ? Math.round(corrMarket * 100) / 100 : null,
    correlationRegime: corrRegime,
  };
}

export const get_risk_regime = handler({
  name: "get_risk_regime",
  description:
    "Risk-regime statistics: beta vs SPY and sector ETF, realized-vol " +
    "regime percentile, and correlation regime.",
  inputSchema: toolInputSchemas.get_risk_regime,
  outputSchema: toolOutputSchemas.get_risk_regime,
  execute: async (input, ctx) => {
    return resolveToolPayload("get_risk_regime", input, ctx, async () => {
      try {
        return await fetchLive(input);
      } catch {
        return emptyPayload("get_risk_regime", input);
      }
    });
  },
});
