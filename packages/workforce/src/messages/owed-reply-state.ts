/**
 * The session state a reply-requested message's obligation is kept in
 * (FIX-2310): a leaf (zod and the pinned key only), so the delivery's state
 * shape spreads it without importing the send. Its writers are `./owed-replies`.
 */
import { z } from "zod";
import { WORKER_REPLIES_OWED_STATE } from "./keys";

/** One reply-requested message a session landed and owes an answer: its id, and the request that landed it. */
const owedReplySchema = z.object({ id: z.string().min(1), by: z.string().min(1) });

export type OwedReply = z.infer<typeof owedReplySchema>;

/** The session state the owed replies are kept in. Server-owned. */
export const owedReplyStateShape = {
  [WORKER_REPLIES_OWED_STATE]: z.array(owedReplySchema).default([])
} as const;

/** The owed replies in a session's state; an entry that doesn't parse is skipped. */
export function owedRepliesOf(state: unknown): OwedReply[] {
  const list = (state as Record<string, unknown> | undefined)?.[WORKER_REPLIES_OWED_STATE];
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const parsed = owedReplySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

