/**
 * Pure helpers that say what a running task is doing now, in one line, for
 * the live "Working..." line at the end of its feed.
 *
 * `toolInFlight` finds the tool call a run's items show still running;
 * `workingStatus` picks the most specific status there is: that call, then
 * the plan step the harness reports in progress, then the run's own progress
 * note. With none of them it answers `undefined`, and the line keeps its
 * plain "Working..." label. Free of DOM and component imports, so any UI
 * layer can use them; pair the line with `StreamingIndicator`.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import { toolIntent, toolSubject } from "./tool-naming";

/** A tool call by its tool's name and its parsed arguments. */
export type ToolCallNow = { tool: string; args: unknown };

/** One row of the plan a harness reports: its title and the harness's own status word, if any. */
export type PlanRowNow = { title: string; status: string | null };

/**
 * The newest tool call in `items` that is still running: a `tool_output`
 * whose output has not arrived. Undefined when none is.
 */
export function toolInFlight(items: readonly OutputItem[]): ToolCallNow | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.type !== "tool_output" || item.status !== "in_progress") continue;
    let args: unknown = {};
    try {
      args = JSON.parse(item.toolCall.arguments || "{}");
    } catch {
      // Arguments still being written read as none: the tool's name still says what runs.
    }
    return { tool: item.toolCall.name, args };
  }
  return undefined;
}

/** "Running pnpm test", "Edit …/src/adapter.ts", or the call's stated intent. */
function toolLine(call: ToolCallNow): string {
  const intent = toolIntent(call.tool, call.args);
  if (intent !== undefined) return intent;
  const subject = toolSubject(call.tool, call.args);
  if (subject === undefined) return `Using ${call.tool}`;
  return subject.code ? `Running ${subject.text}` : subject.text;
}

/** Whatever spelling a harness gives "in progress" (`in_progress`, `IN_PROGRESS`, `in-progress`). */
const inProgress = (status: string | null) => status !== null && status.toLowerCase().replace(/[^a-z]/g, "") === "inprogress";

/** "Step 3 of 5: Add regression test": the first plan row in progress, or undefined. */
function planLine(plan: readonly PlanRowNow[]): string | undefined {
  const at = plan.findIndex((row) => inProgress(row.status));
  return at < 0 ? undefined : `Step ${at + 1} of ${plan.length}: ${plan[at]!.title}`;
}

/**
 * The most specific thing a running task is doing now: the tool call in
 * flight, else the plan step in progress, else its last progress note.
 * Undefined when there is none of them.
 */
export function workingStatus({ inFlight, plan, note }: { inFlight?: ToolCallNow; plan?: readonly PlanRowNow[] | null; note?: string | null }): string | undefined {
  if (inFlight !== undefined) return toolLine(inFlight);
  const step = plan == null ? undefined : planLine(plan);
  if (step !== undefined) return step;
  const trimmed = note?.trim();
  return trimmed ? trimmed : undefined;
}
