// FIX-2848.
/**
 * Who a sent message went to, in words: one wording for every app that draws
 * a sent line (workforce's own renderer, and an app's look over it).
 */
import type { SentMessageTarget } from "./line-values";

/** A worker's id as it is; a task as "task <id>"; a conversation as "conversation <id>"; "another worker" when the line doesn't say. */
export function sentTargetLabel(to: SentMessageTarget | undefined): string {
  if (typeof to === "string") return to;
  if (to !== undefined && "task" in to) return `task ${to.task}`;
  if (to !== undefined && "session" in to) return `conversation ${to.session}`;
  return "another worker";
}
