/**
 * A message row and the log's pinned names (FIX-1989). Zod only, so a
 * browser reads the schema the server writes. The collection is
 * `message-log.ts`. Server-written: sender, hop and sessions are never
 * tool input.
 */
import { z } from "zod";

/** Where the rows live, one per message, at user scope. **Pinned**: persisted, and read by Shift Manager's Messages view. */
export const WORKER_MESSAGES_PATTERN = "workforce/messages/*";

/** The accessor a flow declares the log under. */
export const WORKER_MESSAGES_RESOURCE = "workforceMessages";

/** The longest text a message may carry. A longer one is refused, not cut (BP-042). */
export const MAX_MESSAGE_CHARS = 8_000;

/** Where a message is delivered, or where an answer to it goes: a session on a worker flow, and the state it starts with when it isn't there yet. */
export const messageAddressSchema = z
  .object({
    sessionId: z.string().min(1),
    flow: z.string().min(1),
    /** Present when the session is a worker's derived conversation, which the delivery opens when absent. */
    state: z.record(z.string()).optional()
  })
  .strict();

export type MessageAddress = z.infer<typeof messageAddressSchema>;

/** What became of a message: `delivered` once the host accepted it; `refused` when it refused it; `unconfirmed` when a dispatch threw twice. */
export const MESSAGE_STATUSES = ["delivered", "refused", "unconfirmed"] as const;

/** One message. */
export const workerMessageRowSchema = z.object({
  id: z.string().min(1),
  /** The sending worker's id. */
  from: z.string().min(1),
  /** The recipient worker's id. */
  to: z.string().min(1),
  text: z.string(),
  /** The first message's id in this exchange: a message's own id, or its `replyTo`'s thread. */
  thread: z.string().min(1),
  /** The message this one answers. */
  replyTo: z.string().optional(),
  /** The session the sending turn ran in. */
  fromSession: z.string().min(1),
  /** The flow the sending session runs on. */
  fromFlow: z.string().min(1),
  /** Where this message was delivered. */
  toSession: z.string().min(1),
  toFlow: z.string().min(1),
  /** Where an answer to this message goes: the sending session, or the sender's own conversation when that session was a task's. */
  answerTo: messageAddressSchema,
  /** How many worker messages this one is from the last person's turn. */
  hop: z.number().int().min(1),
  status: z.enum(MESSAGE_STATUSES),
  /** Why the host refused it, or why it is unconfirmed. */
  reason: z.string().optional(),
  /** When it was sent, in ms. */
  at: z.number()
});

export type WorkerMessageRow = z.infer<typeof workerMessageRowSchema>;

