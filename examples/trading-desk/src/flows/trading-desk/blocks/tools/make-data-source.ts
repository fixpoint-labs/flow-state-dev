/**
 * `makeDataSource(mode)` — single switch between the fixture and live
 * implementations. Tools call it lazily so callers never instantiate both.
 */
import type { DataSource, DataSourceMode } from "./data-source";
import { FixtureDataSource } from "./fixture-data-source";
import { LiveDataSource } from "./live-data-source";

export function makeDataSource(mode: DataSourceMode): DataSource {
  if (mode === "live") return new LiveDataSource(new FixtureDataSource());
  return new FixtureDataSource();
}
