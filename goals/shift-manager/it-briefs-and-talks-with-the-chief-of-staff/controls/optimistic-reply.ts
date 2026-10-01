/**
 * Control `optimistic-reply`: the conversation draws the person's line and a
 * canned reply without calling the door.
 *
 * Built into the control page in place of `src/lib/cos.ts`. Sending resolves
 * at once and sends nothing; reading the conversation hands back the lines
 * typed here and a reply written here, so the screen shows *delivered* and a
 * reply while the seat's session holds neither. The goal must fail at "talk".
 */
import type { OutputItem } from "@flow-state-dev/core/items";
export { conversationSession, currentConversation, newConversationId } from "../../../../labs/shift-manager/src/lib/cos.ts";

const typed: string[] = [];

export async function readConversation(): Promise<{ items: OutputItem[]; truncated: boolean }> {
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
  return { items: items as unknown as OutputItem[], truncated: false };
}

export async function sendToChiefOfStaff(_clients: unknown, _target: unknown, message: string): Promise<void> {
  typed.push(message);
}
