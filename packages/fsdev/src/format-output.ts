/**
 * Output formatting for CLI results.
 */

/**
 * Formats data for CLI output. Currently supports JSON only.
 * Future formats (table, compact) can be added here.
 */
export function formatOutput(data: unknown, format: "json" = "json"): string {
  return JSON.stringify(data, null, 2);
}
