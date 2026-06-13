/**
 * Duration-string parser shared across the framework.
 *
 * Converts human-friendly duration strings (`"30s"`, `"5m"`, `"2h"`, `"7d"`)
 * or raw millisecond numbers into milliseconds. Lives in core so any package
 * — server retention policies, the patterns cached-fetch surface — can express
 * freshness/age windows as strings without each maintaining its own parser.
 */

const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/;

const MULTIPLIERS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parse a duration value into milliseconds.
 * Accepts a number (returned as-is) or a duration string like '30s', '5m', '2h', '7d'.
 * Throws on a malformed string.
 */
export function parseDuration(value: number | string): number {
  if (typeof value === "number") return value;
  const match = value.match(DURATION_RE);
  if (match === null) {
    throw new Error(
      `Invalid duration string: "${value}". Expected format: "30s", "5m", "2h", "7d".`
    );
  }
  const num = parseFloat(match[1]);
  const unit = match[2];
  return Math.floor(num * MULTIPLIERS[unit]);
}
