/**
 * Shared helpers for compact tool-call rendering inside container
 * components (evented-actors, task-plan).
 *
 * Both components emit a small visual summary per tool call: tool name
 * (humanized), an optional first-string-arg label (typically a search
 * `query`), and up to 5 result summaries pulled from the tool output.
 * Lifted out of `evented-actors.tsx` so task-plan can adopt the
 * same vocabulary without forking the parser.
 */
import type { ToolOutputItem } from "@flow-state-dev/core/items";

export type ToolCallSummary = {
  name: string;
  displayName: string;
  /** First string argument (commonly the `query` for search tools). */
  query?: string;
  /** Up to 5 short summaries of tool result entries, when extractable. */
  resultSummary?: string[];
};

/** Converts camelCase/kebab-case tool names to Title Case. */
export function formatToolName(name: string): string {
  return name
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Extract a {@link ToolCallSummary} from a substrate
 * `ToolOutputItem`. Robust to:
 * - Plain string outputs (first line, truncated)
 * - Array-of-results outputs (first 5 entries; `title`/`name`/`url`)
 * - `{ results | items | data: [...] }` wrappers (same heuristic)
 *
 * Failures parsing arguments or output return a minimal summary with
 * just the name — never throws.
 */
export function extractToolCallSummary(
  item: ToolOutputItem,
): ToolCallSummary {
  const name = item.toolCall.name;
  let query: string | undefined;
  let resultSummary: string[] | undefined;

  try {
    const args = JSON.parse(item.toolCall.arguments) as Record<string, unknown>;
    const firstString = Object.values(args).find((v) => typeof v === "string");
    if (typeof firstString === "string") query = firstString;
  } catch {
    // ignore — keep query undefined
  }

  try {
    const out = item.output;
    if (typeof out === "string") {
      const first = out.split("\n")[0]?.trim();
      if (first !== undefined && first.length > 0) {
        resultSummary = [first.slice(0, 120)];
      }
    } else if (Array.isArray(out)) {
      resultSummary = summarizeArray(out);
    } else if (out !== null && typeof out === "object") {
      const obj = out as Record<string, unknown>;
      const arr = obj.results ?? obj.items ?? obj.data;
      if (Array.isArray(arr)) {
        resultSummary = summarizeArray(arr);
      }
    }
  } catch {
    // ignore — keep resultSummary undefined
  }

  return {
    name,
    displayName: formatToolName(name),
    ...(query !== undefined ? { query } : {}),
    ...(resultSummary !== undefined ? { resultSummary } : {}),
  };
}

function summarizeArray(arr: unknown[]): string[] {
  return arr
    .slice(0, 5)
    .map((r): string | null => {
      if (typeof r === "string") return r.slice(0, 120);
      if (r === null || typeof r !== "object") return null;
      const obj = r as Record<string, unknown>;
      const title =
        (typeof obj.title === "string" && obj.title) ||
        (typeof obj.name === "string" && obj.name) ||
        (typeof obj.url === "string" && obj.url) ||
        "";
      let host = "";
      if (typeof obj.url === "string") {
        try {
          host = ` — ${new URL(obj.url).hostname}`;
        } catch {
          /* ignore */
        }
      }
      return `${title}${host}`.slice(0, 120);
    })
    .filter((s): s is string => s !== null && s.length > 0);
}
