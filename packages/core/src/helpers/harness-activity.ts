// FIX-2290.
/**
 * Handing a harness run's activity to its host: the one mapping
 * from a harness's translated events to {@link HarnessActivity}, shared by
 * every harness so each reports the same three kinds the same way.
 */
import type { HarnessActivity, HarnessActivityHook, HarnessCallbackContext, HarnessEventHook } from "../types/harness";

/** The translated-event kinds the harnesses share that count as activity. */
type ActivityEvent =
  | { kind: "message" | "message_complete"; text: string }
  | { kind: "tool_call"; name: string; arguments: string }
  | { kind: "reasoning" | "reasoning_complete"; text: string }
  | { kind: string };

/** A whole block of reasoning, by each harness's name for it: Codex's and Cursor's `reasoning`, Claude Code's `reasoning_complete`. */
const REASONING = new Set(["reasoning", "reasoning_complete"]);

/** The activity an event is, or `null` for one that isn't (deltas, results, statuses). */
export function harnessActivityOf(event: ActivityEvent): HarnessActivity | null {
  if (REASONING.has(event.kind)) return { kind: "thinking" };
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

// FIX-2794.
/**
 * Tell `onEvent` the run sent something. Call it on every event, of every
 * kind, before anything else reads the event, without awaiting it. Never
 * throws: a host's failure to note it, thrown or rejected, never fails the run.
 */
export function reportHarnessEvent(onEvent: HarnessEventHook | undefined, ctx: HarnessCallbackContext): void {
  if (onEvent === undefined) return;
  try {
    // `void` admits an async hook, so its promise may come back here.
    const returned: unknown = onEvent(ctx);
    if (returned instanceof Promise) returned.catch(warnEventFailed);
  } catch (error) {
    warnEventFailed(error);
  }
}

function warnEventFailed(error: unknown): void {
  console.warn(`[harness] noting the run's event failed: ${error instanceof Error ? error.message : String(error)}`);
}

function warnActivityFailed(error: unknown): void {
  console.warn(`[harness] reporting the run's activity failed: ${error instanceof Error ? error.message : String(error)}`);
}
