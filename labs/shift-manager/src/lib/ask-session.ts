/**
 * What Inbox's detail draws from the session an ask waits in, besides the ask
 * itself: *From the session*, the last tool calls the worker made before it
 * asked (BR-18), and the person's own lines sent into that session after it.
 *
 * Both are read off the session's stored items, ordered the way the store
 * orders them, never the order a read happened to return.
 */
import { compareItemOrder } from "@flow-state-dev/client";
import type { OutputItem } from "@flow-state-dev/core/items";

/** How many tool calls *From the session* shows (v2:624-633). */
export const FROM_THE_SESSION = 3;

/** One tool call: the tool, what it was pointed at, and what came back. */
export type SessionCall = { id: string; tool: string; target: string; result: string };
/** One line the person sent into the session, and when the session stored it. */
export type SessionReply = { id: string; text: string; at: number };

type ToolOutput = Extract<OutputItem, { type: "tool_output" }>;
type Message = Extract<OutputItem, { type: "message" }>;

/** The first string argument a call was given: its path, command or query. */
function targetOf(call: ToolOutput): string {
  try {
    const value = Object.values(JSON.parse(call.toolCall.arguments) as Record<string, unknown>).find((v) => typeof v === "string");
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

/** The call's result in a few words: its error, the first line of a text answer, or *done*. */
function resultOf(call: ToolOutput): string {
  if (call.error !== undefined) return "failed";
  const first = typeof call.output === "string" ? call.output.split("\n")[0]!.trim() : "";
  return first.length > 0 ? first : "done";
}

function textOf(message: Message): string {
  return message.content
    .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

/**
 * The ask's session around the ask: the last {@link FROM_THE_SESSION} tool
 * calls stored before it, oldest first, and the person's lines stored after
 * it. `null` when the read doesn't hold the ask (a session longer than the
 * read): nothing in it can then be placed before or after the ask.
 */
export function askSessionOf(items: readonly OutputItem[], ask: OutputItem): { calls: SessionCall[]; replies: SessionReply[] } | null {
  if (!items.some((item) => item.id === ask.id && item.requestId === ask.requestId)) return null;
  const ordered = [...items].sort(compareItemOrder);
  const before = ordered.filter((item) => compareItemOrder(item, ask) < 0);
  const after = ordered.filter((item) => compareItemOrder(item, ask) > 0);
  return {
    calls: before
      .filter((item): item is ToolOutput => item.type === "tool_output")
      .slice(-FROM_THE_SESSION)
      .map((call) => ({ id: call.id, tool: call.toolCall.name, target: targetOf(call), result: resultOf(call) })),
    replies: after
      .filter((item): item is Message => item.type === "message" && item.role === "user")
      .map((message) => ({ id: message.id, text: textOf(message), at: message.ts })),
  };
}
