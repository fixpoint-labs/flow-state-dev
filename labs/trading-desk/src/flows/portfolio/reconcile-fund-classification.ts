/**
 * Detects a fund/crypto instrument mistyped `assetType: "equity"` at import
 * (FIX-762 follow-up). A GICS sector genuinely doesn't apply to a fund, so a
 * null sector alone can't tell "unclassified equity" apart from "correctly
 * sectorless ETF that was never typed as one" — Yahoo's own `quoteType`
 * instrument-kind field can. Only used as a fallback AFTER a sector lookup
 * already came back null (the classifications route's miss path); a ticker
 * with a real sector is never second-guessed here.
 */
import { getOrFetch } from "../analysis/tools/runtime/cache";
import { fetchYahooQuoteKind } from "../analysis/tools/providers/yahoo";
import { classifyInstrument, type Classification } from "./classify-instrument";
import type { AssetType } from "./portfolio-schema";

/** Yahoo's instrument-kind discriminator → our `assetTypeHint`. Only
 *  fund/crypto/cash kinds are corrected — `EQUITY` (and anything else:
 *  `INDEX`, `CURRENCY`, `FUTURE`, `OPTION`, an unrecognized kind) is left
 *  alone; that's the legitimate "real equity, Yahoo just has no sector for
 *  it" case, not a misclassification. */
function assetTypeHintFromYahooQuoteKind(quoteKind: string | null): AssetType | null {
  switch (quoteKind) {
    case "ETF":
      return "etf";
    case "MUTUALFUND":
      return "mutual_fund";
    case "CRYPTOCURRENCY":
      return "crypto";
    case "MONEYMARKET":
      return "money_market";
    default:
      return null;
  }
}

/**
 * For a ticker stored as `assetType: "equity"` whose sector lookup already
 * came back null, ask Yahoo whether it's actually a fund/crypto instrument.
 * Returns the corrected classification (reusing the SAME classifier every
 * import path uses — `classifyInstrument`, so a known bond ETF still resolves
 * to `fixed_income`/`etf`, not a blanket `equity`/`etf`), or null when Yahoo
 * says it's a real equity, or the lookup itself fails (a transient miss stays
 * uncorrected — the ticker is retried on a later request, same as the sector
 * lookup it follows).
 *
 * Cache-deduped (`resolveSector`'s own idiom) — this runs alongside a sector
 * lookup for every miss, so caching halves the added Yahoo request volume a
 * bounded multi-ticker fill puts on Yahoo's free, unauthenticated endpoint.
 */
export async function reconcileFundClassification(
  ticker: string,
): Promise<Classification | null> {
  const quoteKind = await getOrFetch("yahoo-quote-kind", { ticker }, () =>
    fetchYahooQuoteKind(ticker),
  );
  const hint = assetTypeHintFromYahooQuoteKind(quoteKind);
  if (hint === null) return null;
  return classifyInstrument(ticker, { assetTypeHint: hint });
}
