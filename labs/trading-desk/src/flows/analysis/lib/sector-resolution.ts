/**
 * Shared GICS sector → ETF resolution.
 *
 * Extracted from `get_sector_context.ts` for reuse by the Quant Analyst's
 * risk-regime tool (needs the sector ETF for sector-relative beta/correlation).
 */
import { getOrFetch } from "@/src/lib/cache";
import { fetchYahooCompanyProfile } from "@/src/providers/yahoo";

/** GICS sector → Select Sector SPDR ETF. Covers the 11 standard GICS
 *  sectors. Returns null for unmapped/unknown sectors. */
export const GICS_TO_ETF: Record<string, string> = {
  Technology: "XLK",
  "Communication Services": "XLC",
  "Consumer Cyclical": "XLY",
  "Consumer Defensive": "XLP",
  Energy: "XLE",
  "Financial Services": "XLF",
  Healthcare: "XLV",
  Industrials: "XLI",
  "Basic Materials": "XLB",
  "Real Estate": "XLRE",
  Utilities: "XLU",
};

/** Resolve a ticker's sector and map it to a sector ETF.
 *  Uses a soft Yahoo profile fetch (cache-deduped). Returns nulls on failure. */
export async function resolveSector(
  ticker: string,
  date: string,
): Promise<{ sector: string | null; industry: string | null; sectorEtf: string | null }> {
  let sector: string | null = null;
  let industry: string | null = null;
  try {
    const profile = await getOrFetch(
      "yahoo-profile-sector",
      { ticker },
      () => fetchYahooCompanyProfile({ ticker, date }),
    );
    sector = profile.sector;
    industry = profile.industry;
  } catch {
    // Sector unresolvable — proceed with nulls.
  }
  const sectorEtf = sector !== null ? (GICS_TO_ETF[sector] ?? null) : null;
  return { sector, industry, sectorEtf };
}
