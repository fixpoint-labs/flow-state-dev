/**
 * The Inbox's browser client: its one answer call, routed by each hold's
 * source. A suspension goes to the engine's answer route (FIX-2129), with the
 * answer its ask takes mapped to the engine's resume action there; a row hold
 * goes to the board's `updateTask`, which arrives with the row holds.
 */
import type { Client } from "@flow-state-dev/client";
import type { ResumeAction } from "@flow-state-dev/core/types";
import { ROW_HOLD_UNANSWERABLE } from "./holds";
import type { InboxAnswer, InboxAskKind, InboxHold, InboxItem } from "./types";

/** The engine's resume action and data for a suspension hold's answer. */
function resumeOf(kind: InboxAskKind, answer: InboxAnswer): { action: ResumeAction; data?: unknown } {
  const a = answer as Record<string, unknown>;
  if (kind === "approval" && typeof a.approved === "boolean") return { action: a.approved ? "approve" : "reject", ...(a.data !== undefined ? { data: a.data } : {}) };
  if ((kind === "input" || kind === "review") && a.skipped === true) return { action: "skip" };
  if ((kind === "input" || kind === "review") && "value" in a) return { action: "submit", data: a.value };
  throw new Error(`An answer to ${kind === "approval" ? "an approval" : `a ${kind}`} hold doesn't take ${JSON.stringify(answer)}`);
}

/** The Inbox's client: its one answer call. */
export type InboxClient = {
  /**
   * Answer `item`'s hold `holdId` (its first when omitted) with the answer
   * its ask takes. Rejects when the hold isn't answerable, or the route refuses.
   */
  answer(item: InboxItem<unknown>, answer: InboxAnswer, holdId?: string): Promise<void>;
  /** Answer one hold, as an item's are answered: for a hold drawn on its own, such as an ask in a task's session view. */
  answerHold(hold: InboxHold<unknown>, answer: InboxAnswer): Promise<void>;
};

/** The Inbox's client over one connection. */
export function createInboxClient(client: Client): InboxClient {
  const answerHold: InboxClient["answerHold"] = async (hold, answer) => {
    if (hold.unanswerable !== null) throw new Error(hold.unanswerable);
    if (hold.source.kind !== "suspension") throw new Error(ROW_HOLD_UNANSWERABLE);
    const { flowId, requestId, suspensionId } = hold.source;
    if (flowId === null) throw new Error(`Inbox hold "${hold.id}" names no flow`);
    const resume = resumeOf(hold.ask.kind, answer);
    await client.flow(flowId).request(requestId).answer({ suspensionId, ...resume });
  };
  return {
    answerHold,
    async answer(item, answer, holdId) {
      const hold = holdId === undefined ? item.holds[0] : item.holds.find((h) => h.id === holdId);
      if (hold === undefined) throw new Error(`Inbox item "${item.id}" holds no "${holdId}"`);
      await answerHold(hold, answer);
    },
  };
}
