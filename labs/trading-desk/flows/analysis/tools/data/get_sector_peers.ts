/**
 * Sector peers handler: fetches the Finnhub peer set and trailing ~1-month
 * returns for each peer via Yahoo. Caps at ~6 peers to keep prompt size and
 * API budget bounded. Computes a median peer return for the analyst to
 * compare against the name's own move.
 */
import { handler } from "@flow-state-dev/core";
import { resolveToolPayload } from "../runtime/resolve";
import { fetchFinnhubPeers } from "@/lib/providers/finnhub";
import { fetchYahooChart } from "@/lib/providers/yahoo";
import { emptyPayload } from "../empty-payloads";
import { trailingReturn } from "../indicators-math";
import {
  toolInputSchemas,
  toolOutputSchemas,
  type ToolInput,
  type ToolOutput,
} from "../schemas";

const MAX_PEERS = 6;

/** Median of an array of numbers. Returns null for empty arrays. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

async function fetchLive(
  input: ToolInput<"get_sector_peers">,
): Promise<ToolOutput<"get_sector_peers">> {
  const grouping = "subIndustry";
  let peerTickers: string[];
  try {
    peerTickers = await fetchFinnhubPeers(input.ticker, grouping);
  } catch {
    return emptyPayload("get_sector_peers", input);
  }

  const capped = peerTickers.slice(0, MAX_PEERS);

  const peerResults = await Promise.allSettled(
    capped.map(async (ticker) => {
      try {
        const chart = await fetchYahooChart({
          ticker,
          date: input.date,
          range: "1mo",
        });
        return {
          ticker,
          name: null as string | null,
          return1m: trailingReturn(chart.bars),
        };
      } catch {
        return { ticker, name: null as string | null, return1m: null };
      }
    }),
  );

  const peers = peerResults
    .filter(
      (r): r is PromiseFulfilledResult<{ ticker: string; name: string | null; return1m: number | null }> =>
        r.status === "fulfilled",
    )
    .map((r) => r.value);

  const returns = peers
    .map((p) => p.return1m)
    .filter((r): r is number => r !== null);

  return {
    source: peers.length > 0 ? "finnhub" : "unavailable",
    ticker: input.ticker,
    asOf: input.date,
    grouping,
    peers,
    peerMedianReturn1m: median(returns),
  };
}

export const get_sector_peers = handler({
  name: "get_sector_peers",
  description:
    "Peer set from Finnhub with trailing ~1-month returns from Yahoo. " +
    "Capped at ~6 peers. Includes the peer-set median return for " +
    "relative comparison.",
  inputSchema: toolInputSchemas.get_sector_peers,
  outputSchema: toolOutputSchemas.get_sector_peers,
  execute: async (input, ctx) => {
    return resolveToolPayload("get_sector_peers", input, ctx, async () => {
      try {
        return await fetchLive(input);
      } catch {
        return emptyPayload("get_sector_peers", input);
      }
    });
  },
});
