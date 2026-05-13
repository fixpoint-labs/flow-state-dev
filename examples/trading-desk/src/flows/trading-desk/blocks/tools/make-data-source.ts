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
import { MultiSourceDataSource } from "./multi-source-data-source";
import { YahooDataSource } from "./yahoo-data-source";

export function makeDataSource(mode: DataSourceMode): DataSource {
  if (mode !== "live") return new FixtureDataSource();
  const chain: DataSource[] = [];
  const finnhubKey = getFinnhubKey();
  if (finnhubKey) chain.push(new FinnhubDataSource(finnhubKey));
  chain.push(new YahooDataSource());
  return new MultiSourceDataSource(chain);
}
