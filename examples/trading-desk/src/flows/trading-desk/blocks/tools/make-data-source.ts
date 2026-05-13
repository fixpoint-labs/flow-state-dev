/**
 * `makeDataSource(mode)` — picks the data layer for the current request.
 *
 *   - `"fixture"` → `FixtureDataSource` only. Hand-curated JSON shipped with
 *                   the example. Stamps `source: "fixture"`.
 *   - `"live"`    → `MultiSourceDataSource` chaining Finnhub (when
 *                   `FINNHUB_API_KEY` is set) → Yahoo. **No fixture floor.**
 *                   If every live provider fails for a tool, the chain emits
 *                   an empty schema-valid payload tagged `"unavailable"`.
 *                   Fixture data is never silently substituted in live mode
 *                   because false data is worse than no data for analyst
 *                   reasoning.
 *
 * Tools call this lazily inside their handler `execute`, so neither provider
 * instantiates unless its mode is selected.
 */
import type { DataSource, DataSourceMode } from "./data-source";
import { FixtureDataSource } from "./fixture-data-source";
import { FinnhubDataSource, getFinnhubKey } from "./finnhub-data-source";
import { FredDataSource, getFredKey } from "./fred-data-source";
import { MultiSourceDataSource } from "./multi-source-data-source";
import { YahooDataSource } from "./yahoo-data-source";

export function makeDataSource(mode: DataSourceMode): DataSource {
  if (mode !== "live") return new FixtureDataSource();
  // Order matters per-tool: each provider declares which tools it supports
  // and throws ProviderUnsupportedError for the rest. The chain walks until
  // a provider answers (or every provider has failed → "unavailable").
  //   Finnhub — fundamentals, prices, news (when key present).
  //   Yahoo   — fundamentals, prices, statements (fallback for above).
  //   FRED    — macro indicators (when key present).
  const chain: DataSource[] = [];
  const finnhubKey = getFinnhubKey();
  if (finnhubKey) chain.push(new FinnhubDataSource(finnhubKey));
  chain.push(new YahooDataSource());
  const fredKey = getFredKey();
  if (fredKey) chain.push(new FredDataSource(fredKey));
  return new MultiSourceDataSource(chain);
}
