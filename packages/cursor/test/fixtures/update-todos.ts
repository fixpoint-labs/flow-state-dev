/**
 * Cursor's `updateTodos` call, as it reaches `run.stream()` at the pinned SDK.
 *
 * Shaped from what `@cursor/sdk` 1.0.31's own conversion code does (FIX-1917's
 * `poc/sdk-wire`, facts F1 to F3): the args are `{content, status}` pairs with
 * no item id and no merge flag, so an update can name only part of the list;
 * a success result carries the whole list after the update, plus a count; an
 * error result carries a message. The stream message is a `tool_call` named
 * `updateTodos`, opened `running` and settled `completed` or `error`.
 */
import type { CursorSdkMessage } from "../../src/types";

/** One to-do item as the SDK spells it. */
export interface WireTodo {
  content: string;
  status: string;
}

/** The whole list after the partial update below: four items. */
export const WHOLE_LIST: WireTodo[] = [
  { content: "Read the failing test", status: "completed" },
  { content: "Fix the parser", status: "inProgress" },
  { content: "Run the suite", status: "pending" },
  { content: "Write the changelog", status: "pending" },
];

/** The update Cursor SENT: two of the four items, which alone cannot be placed. */
export const PARTIAL_ARGS: WireTodo[] = [
  { content: "Read the failing test", status: "completed" },
  { content: "Fix the parser", status: "inProgress" },
];

/** The call while it runs: args only, no result. */
export function todosRunning(callId: string, args: WireTodo[] = PARTIAL_ARGS): CursorSdkMessage {
  return { type: "tool_call", call_id: callId, name: "updateTodos", status: "running", args: { todos: args } };
}

/** The call settled with the list Cursor confirmed. */
export function todosSettled(
  callId: string,
  todos: WireTodo[] = WHOLE_LIST,
  args: WireTodo[] = PARTIAL_ARGS,
): CursorSdkMessage {
  return {
    type: "tool_call",
    call_id: callId,
    name: "updateTodos",
    status: "completed",
    args: { todos: args },
    result: { status: "success", value: { todos, totalCount: todos.length } },
  };
}

/** The call settled as an error: Cursor rejected the update. */
export function todosFailed(callId: string, args: WireTodo[] = PARTIAL_ARGS): CursorSdkMessage {
  return {
    type: "tool_call",
    call_id: callId,
    name: "updateTodos",
    status: "error",
    args: { todos: args },
    result: { status: "error", error: { message: "todo store unavailable" } },
  };
}
