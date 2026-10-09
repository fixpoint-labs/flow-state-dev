/**
 * Control `optimistic-reply`: the conversation draws the person's line and a
 * canned reply without calling the door.
 *
 * Built into the control page in place of both modules a conversation runs
 * through: `src/lib/conversation.ts` (the hook that reads the seat's session)
 * and `src/lib/send.ts` (the one send path its composer calls). One module
 * stands in for both.
 *
 * - `openConversation` opens nothing, and `sendTurn` resolves at once and
 *   sends nothing, so the composer reads *delivered* while no session holds
 *   the line.
 * - `useSeatConversation` hands back the lines typed here, each with a reply
 *   written here, in place of what the session stores.
 *
 * The goal must fail at "talk" ("delivered was drawn while no session …
 * held a user item with the token").
 */
import type { SessionSummary } from "@flow-state-dev/client";
import type { OutputItem } from "@flow-state-dev/core/items";
import { useSeatConversation as useStoredConversation, type SeatConversation } from "../../../../packages/shift-manager/src/lib/conversation.ts";
import type { Seat } from "../../../../packages/shift-manager/src/lib/reads.ts";
import type { sendTurn as realSendTurn } from "../../../../packages/shift-manager/src/lib/send.ts";

export * from "../../../../packages/shift-manager/src/lib/conversation.ts";
export * from "../../../../packages/shift-manager/src/lib/send.ts";

const typed: string[] = [];

/** Opens nothing: the Lab is never asked. */
export async function openConversation(): Promise<void> {}

/** Read the line as delivered; the seat's door is never called. */
export const sendTurn: typeof realSendTurn = async (_clients, _target, message) => {
  typed.push(message);
  return { requestId: "never-sent", suspended: false, stopped: null };
};

/** The real hook, with the session's items replaced by the lines typed here and a canned reply to each. */
export function useSeatConversation(seat: Seat, sessions: readonly SessionSummary[]): SeatConversation {
  const stored = useStoredConversation(seat, sessions);
  if (typed.length === 0) return stored;
  const items = typed.flatMap((line, i) => [
    { id: `local_user_${i}`, type: "message", role: "user", status: "completed", requestId: `local_${i}`, content: [{ type: "output_text", text: line }] },
    {
      id: `local_reply_${i}`,
      type: "message",
      role: "assistant",
      status: "completed",
      requestId: `local_${i}`,
      content: [{ type: "output_text", text: "Noted. I'll take care of it." }],
    },
  ]);
  return { ...stored, read: { items: items as unknown as OutputItem[], truncated: false }, failure: undefined };
}
