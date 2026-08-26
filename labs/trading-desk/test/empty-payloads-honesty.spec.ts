/**
 * The empty-payload builders publish NULL, never a fabricated zero (FIX-1063).
 *
 * A builder in `empty-payloads.ts` fires precisely when no provider could
 * answer, so every numeric field it emits is unobserved BY CONSTRUCTION — there
 * is no path by which one of these carries a measurement. That makes the rule
 * here absolute, and makes this the cheapest of the four producer paths to
 * verify: if a field is a number, it was invented.
 *
 * Five builders emitted zeros before this fix. The three statement builders
 * (balance sheet / income / cashflow) already emitted null and are asserted
 * alongside them, because the whole point of the change is that the desk now
 * carries ONE convention instead of two opposite ones.
 *
 * The check is written as a generic walk rather than a field list so a numeric
 * field added to any of these payloads later cannot quietly skip it.
 */
import { describe, expect, it } from "vitest";
import { emptyPayload } from "../flows/analysis/tools/empty-payloads";
import { toolOutputSchemas } from "../flows/analysis/tools/schemas";

const ARGS = { ticker: "NVDA", date: "2026-05-06" } as const;

/** Every dotted path in `value` whose leaf is a number. */
function numericPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "number") return [prefix];
  if (Array.isArray(value)) return [];
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) =>
      numericPaths(v, prefix === "" ? k : `${prefix}.${k}`),
    );
  }
  return [];
}

/** The tools whose unavailable payload must carry no measured figure at all.
 *  `windowDays` on insider transactions is a REQUEST parameter, not a reading,
 *  so that tool is deliberately not in this list. */
const NO_FABRICATED_NUMBERS = [
  "get_fundamentals",
  "compute_indicators",
  "get_macro_indicators",
  "get_social_sentiment",
  "get_reddit_mentions",
  "get_balance_sheet",
  "get_income_statement",
  "get_cashflow",
] as const;

describe("empty payloads carry no fabricated measurements", () => {
  for (const tool of NO_FABRICATED_NUMBERS) {
    it(`${tool}: every numeric field reads null`, () => {
      const payload = emptyPayload(tool, ARGS as never);
      expect(payload.source).toBe("unavailable");
      // A number anywhere in this payload is a figure nobody measured.
      expect(numericPaths(payload)).toEqual([]);
    });

    it(`${tool}: the nulled payload still satisfies its output schema`, () => {
      // Honesty must not cost schema validity — an `unavailable` payload still
      // flows through the same tool contract as a live one.
      const parsed = toolOutputSchemas[tool].safeParse(emptyPayload(tool, ARGS as never));
      expect(parsed.success).toBe(true);
    });
  }

  it("compute_indicators reports NO trend rather than a 'flat' one", () => {
    // Called out separately because it is not a number and the generic walk
    // above cannot see it. "flat" is a finding — a measured stack that is
    // neither rising nor falling — and asserting it on a payload where no
    // provider answered is the same fabrication one type up (FIX-1063
    // decision 2).
    expect(emptyPayload("compute_indicators", ARGS).trend).toBeNull();
  });

  it("the source tag still says unavailable, so nulls and provenance agree", () => {
    // The nulls do not replace the provenance marker; they make the payload's
    // VALUES stop contradicting it.
    for (const tool of NO_FABRICATED_NUMBERS) {
      expect(emptyPayload(tool, ARGS as never).source).toBe("unavailable");
    }
  });
});
