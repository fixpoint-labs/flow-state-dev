/**
 * Financial Modeling Prep (FMP) provider — optional enrichment layer.
 *
 * FMP provides earnings-call transcripts, forward consensus estimates,
 * price-target summaries, and analyst rating actions. All endpoints require
 * an `FMP_API_KEY` (free Basic tier, 250 req/day).
 *
 * PR1: key-check helper only. PR2 wires the actual fetch functions.
 * Tools using this helper: get_earnings_transcript, get_analyst_estimates.
 */

export function hasFmpKey(): boolean {
  return Boolean(process.env.FMP_API_KEY?.trim());
}
