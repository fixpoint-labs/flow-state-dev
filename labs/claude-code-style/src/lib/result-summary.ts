/**
 * What a background result card says. A task's notice line carries its output
 * as text, which for a coding run is the run's JSON (`issue`, `answer`,
 * `branch`, `commits`...). The card shows the run's `answer`; any other output
 * shows as it came.
 */

/** The `answer` field's string, read even when the notice cut the JSON short after it. */
const ANSWER = /"answer"\s*:\s*("(?:[^"\\]|\\.)*")/;

/** The card's text for a result whose notice line said `summary`. */
export function resultSummary(summary: string): string {
  const trimmed = summary.trim();
  if (!trimmed.startsWith("{")) return summary;
  const answer = ANSWER.exec(trimmed);
  if (answer === null) return summary;
  try {
    const text: unknown = JSON.parse(answer[1]!);
    return typeof text === "string" && text.length > 0 ? text : summary;
  } catch {
    return summary;
  }
}
