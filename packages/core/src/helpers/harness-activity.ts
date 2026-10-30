/**
 * Handing a harness run's activity to its host (FIX-2290): the one mapping
 * from a harness's translated events to {@link HarnessActivity}, shared by
 * every harness so each reports the same two kinds the same way.
 */
import type { HarnessActivity, HarnessActivityHook, HarnessCallbackContext } from "../types/harness";

/** The translated-event kinds the harnesses share that count as activity. */
type ActivityEvent =
  | { kind: "message" | "message_complete"; text: string }
  | { kind: "tool_call"; name: string; arguments: string }
  | { kind: string };

/** The activity an event is, or `null` for one that isn't (deltas, results, reasoning). */
export function harnessActivityOf(event: ActivityEvent): HarnessActivity | null {
  if ((event.kind === "message" || event.kind === "message_complete") && "text" in event) {
    return { kind: "message", text: event.text };
  }
  if (event.kind === "tool_call" && "name" in event && "arguments" in event) {
    return { kind: "tool", name: event.name, arguments: event.arguments };
  }
  return null;
}

/**
 * Hand an event to `onActivity` when it is activity, without awaiting it.
 * Never throws: a host's failure to record how the run is doing, thrown or
 * rejected, never fails the run.
 */
export function reportHarnessActivity(
  onActivity: HarnessActivityHook | undefined,
  event: ActivityEvent,
  ctx: HarnessCallbackContext,
): void {
  if (onActivity === undefined) return;
  const activity = harnessActivityOf(event);
  if (activity === null) return;
  try {
    // `void` admits an async hook, so its promise may come back here.
    const returned: unknown = onActivity(activity, ctx);
    if (returned instanceof Promise) returned.catch(warnActivityFailed);
  } catch (error) {
    warnActivityFailed(error);
  }
}

function warnActivityFailed(error: unknown): void {
  console.warn(`[harness] reporting the run's activity failed: ${error instanceof Error ? error.message : String(error)}`);
}
