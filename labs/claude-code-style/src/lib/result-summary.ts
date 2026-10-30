/**
 * What a background result card says. A task's notice line carries its output
 * as text, which for a coding run is the run's JSON (`issue`, `answer`,
 * `branch`, `commits`...). The card shows the run's top-level `answer`; any
 * other output, a nested `answer` included, shows as it came.
 */

/** The card's text for a result whose notice line said `summary`. */
export function resultSummary(summary: string): string {
  const trimmed = summary.trim();
  if (!trimmed.startsWith("{")) return summary;
  const answer = topLevelAnswer(trimmed);
  return answer !== undefined && answer.length > 0 ? answer : summary;
}

/** The object's own `answer` string, read even when the notice cut the JSON short after it. */
function topLevelAnswer(json: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(json);
    const answer = (parsed as { answer?: unknown } | null)?.answer;
    return typeof answer === "string" ? answer : undefined;
  } catch {
    // Cut short: walk the text, and take `"answer": "..."` only at the outer object's depth.
  }
  let depth = 0;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
    else if (c === '"') {
      const end = stringEnd(json, i);
      if (end === undefined) return undefined;
      if (depth === 1 && json.slice(i, end + 1) === '"answer"') {
        const value = /^\s*:\s*("(?:[^"\\]|\\.)*")/.exec(json.slice(end + 1));
        if (value !== null) return JSON.parse(value[1]!) as string;
      }
      i = end;
    }
  }
  return undefined;
}

/** Where the string starting at `start` closes, or undefined when the text ends first. */
function stringEnd(text: string, start: number): number | undefined {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i;
  }
  return undefined;
}
