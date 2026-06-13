/**
 * Options-chain read for the analyzed ticker (Massive / Polygon) — the Quant
 * Analyst's derivatives-positioning lane. One option-chain snapshot, reduced by
 * the pure `options-math` functions to ATM implied vol, the IV term-structure
 * tilt, the 25-delta skew, and the put/call open-interest balance.
 *
 * Massive is the only source for this signal (no fallback chain): the desk has
 * no other options provider. A missing key, an unentitled options product, or a
 * transport failure degrades to `source: "unavailable"` (BP-020) — never a
 * fabricated chain. An empty-but-successful chain (a name with no listed
 * options) stays `source: "massive"` with null derived fields.
 */
import { handler } from "@flow-state-dev/core";
import { resolveToolPayload } from "../runtime/resolve";
import { fetchOptionChainSnapshot, hasMassiveKey } from "../providers/massive";
import {
  atmIv,
  classifyTermStructure,
  distinctExpiries,
  putCallOiRatio,
  skew25Delta,
  sumField,
} from "./options-math";
import { emptyPayload } from "../empty-payloads";
import {
  toolInputSchemas,
  toolOutputSchemas,
  type ToolInput,
  type ToolOutput,
} from "../schemas";

/** A far-minus-near ATM IV move inside ±0.5 vol points is a flat term structure. */
const IV_TERM_DEADBAND = 0.005;

async function fetchLive(
  input: ToolInput<"get_options_chain">,
): Promise<ToolOutput<"get_options_chain">> {
  const { spot, contracts } = await fetchOptionChainSnapshot(input.ticker);
  const expiries = distinctExpiries(contracts);
  const nearestExpiry = expiries[0] ?? null;
  const farExpiry = expiries.length > 1 ? expiries[expiries.length - 1]! : null;

  const nearIv = nearestExpiry ? atmIv(contracts, spot, nearestExpiry) : null;
  const farIv = farExpiry ? atmIv(contracts, spot, farExpiry) : null;
  const ivTermSlope = nearIv !== null && farIv !== null ? farIv - nearIv : null;

  return {
    source: "massive",
    ticker: input.ticker,
    asOf: input.date,
    spotPrice: spot,
    nearestExpiry,
    atmIv: nearIv,
    ivTermStructure: classifyTermStructure(ivTermSlope, IV_TERM_DEADBAND),
    ivTermSlope,
    skew25Delta: nearestExpiry ? skew25Delta(contracts, nearestExpiry) : null,
    putCallOiRatio: putCallOiRatio(contracts),
    totalOpenInterest: sumField(contracts, "openInterest"),
    totalVolume: sumField(contracts, "volume"),
    expiriesCovered: expiries.length,
  };
}

export const get_options_chain = handler({
  name: "get_options_chain",
  description:
    "Options-chain snapshot for a ticker (Massive): ATM implied vol, IV term " +
    "structure, 25-delta skew, and put/call open-interest balance.",
  inputSchema: toolInputSchemas.get_options_chain,
  outputSchema: toolOutputSchemas.get_options_chain,
  execute: async (input, ctx) => {
    return resolveToolPayload("get_options_chain", input, ctx, async () => {
      if (!hasMassiveKey()) return emptyPayload("get_options_chain", input);
      try {
        return await fetchLive(input);
      } catch {
        return emptyPayload("get_options_chain", input);
      }
    });
  },
});
