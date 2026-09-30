/**
 * Runs inside the consumer project, under the vitest the project installed.
 * One test per specifier in `FSD_PROBE_SPECS`: it passes when the specifier
 * imports. Used for entry points that depend on vitest and can only load in a
 * vitest run; the packed-install check reads the JSON report.
 */
import { test } from "vitest";

for (const spec of JSON.parse(process.env.FSD_PROBE_SPECS ?? "[]")) {
  test(spec, async () => {
    await import(spec);
  });
}
