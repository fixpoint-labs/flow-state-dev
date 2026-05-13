/**
 * `makeDataSource(mode)` — picks the data layer for the current request.
 *
 *   - `"fixture"` → `FixtureDataSource` only.
 *   - `"live"`    → `MultiSourceDataSource` chaining Finnhub (when
 *                   `FINNHUB_API_KEY` is set) → Yahoo → Fixture. The fixture
 *                   floor means a tool call only fails if even the bundled
 *                   fixture for `(ticker, date, tool)` is missing.
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
  chain.push(new FixtureDataSource());
  return new MultiSourceDataSource(chain);
}
