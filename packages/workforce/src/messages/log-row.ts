/**
 * A message log row's shape and the log's pinned names (FIX-1989): a leaf
 * module (zod only), so a browser reads the log with the schema the server
 * writes it with. The log itself is `message-log.ts`.
 *
 * The message log: one row per message a worker sent another, in
 * the user's own scope. What the Messages view reads, what an answer is routed
 * by (the row keeps where an answer to it goes), and what survives a restart.
 *
 * Written by the server only, from the sending turn's own session: the sender,
 * the hop count and the sessions are never tool input.
 */
import { z } from "zod";

/** Where the rows live, one per message, at user scope. **Pinned**: persisted, and read by Shift Manager's Messages view. */
export const WORKER_MESSAGES_PATTERN = "workforce/messages/*";

/** The accessor a flow declares the log under. */
export const WORKER_MESSAGES_RESOURCE = "workforceMessages";

/** The longest text a message may carry. A longer one is refused, not cut (BP-042). */
export const MAX_MESSAGE_CHARS = 8_000;

/** Where a message is delivered: a session on a worker flow, and the state it starts with when it isn't there yet. */
export const messageAddressSchema = z
  .object({
    sessionId: z.string().min(1),
    flow: z.string().min(1),
    /** Present when the session is a worker's derived conversation, which the delivery opens when absent. */
    state: z.record(z.string()).optional()
  })
  .strict();

export type MessageAddress = z.infer<typeof messageAddressSchema>;

/**
 * What became of a message (FIX-2240): `unconfirmed` until the recipient's
 * `onMessageReceived` takes it; `delivered` once it landed there; `refused`,
 * final; `undeliverable` once it was owed past the host's debt age.
 */
export const MESSAGE_STATUSES = ["unconfirmed", "delivered", "refused", "undeliverable"] as const;

/** One message. */
export const workerMessageRowSchema = z.object({
  id: z.string().min(1),
  /** The sending worker's id. */
  from: z.string().min(1),
  /** The recipient worker's id. */
  to: z.string().min(1),
  /**
   * How the sender addressed it (FIX-2160): by a task (`task`) or a conversation
   * (`session`). Absent when by the worker's name, as on every row from before.
   */
  addressedBy: z.enum(["task", "session"]).optional(),
  /** The task it was addressed to, when `addressedBy` is `task`. */
  toTask: z.string().min(1).optional(),
  text: z.string(),
  /** The first message's id in this exchange: a message's own id, or the exchange of the message it answers. */
  exchange: z.string().min(1),
  /** The message this one answers. */
  inReplyTo: z.string().optional(),
  /** The session the sending turn ran in: where an answer to this message lands. */
  fromSession: z.string().min(1),
  /** The flow the sending session runs on. */
  fromFlow: z.string().min(1),
  /** Where this message was delivered. */
  toSession: z.string().min(1),
  toFlow: z.string().min(1),
  /** The state a derived conversation is opened with, so a resend opens it too when the first dispatch never did. */
  toState: z.record(z.string()).optional(),
  /** How many worker messages this one is from the last user's turn, counted across the whole exchange. */
  hop: z.number().int().min(1),
  /** The chain the hop is counted in: the user's turn the exchange descends from. Absent on rows from before rows carried one. */
  chain: z.string().min(1).optional(),
  status: z.enum(MESSAGE_STATUSES),
  /** Why it was refused or couldn't be delivered, or why its last send failed. */
  reason: z.string().optional(),
  /**
   * A call (FIX-2239): the sender waits on the recipient's reply, the result
   * of the request that acts on it. Server-set from the tool's `wait`, never
   * input. Absent on a plain message.
   */
  call: z.literal(true).optional(),
  /** When a call's sender stops waiting (epoch ms): a reply after it is late. */
  deadlineAt: z.number().optional(),
  /** When a call's reply was given: the recipient's turn ended. */
  repliedAt: z.number().optional(),
  /**
   * The sender asked for a reply and goes on without waiting (FIX-2310): the
   * recipient owes one answer, which reaches the sender as a message. From the
   * tool's `replyRequested`. Absent on a plain message and on a call, whose
   * reply is its tool's result.
   */
  replyRequested: z.literal(true).optional(),
  /** The message that answered this one, once one did (FIX-2310): set once, so a second answer is never sent. */
  answeredBy: z.string().min(1).optional(),
  /** This message is the framework's "no answer" to the one it answers (FIX-2310): its recipient's turn ended with nothing to say, or failed. */
  noAnswer: z.literal(true).optional(),
  /**
   * Why a taken message waits before it lands (FIX-2239): its session is
   * stopped for the user, or its task is held on one. Cleared when it lands.
   */
  queuedBehind: z.literal("user").optional(),
  /** The `onMessageReceived` request that took it (FIX-2123's take, on a message). */
  takenBy: z.string().min(1).optional(),
  /** The request it landed in. Set once. */
  deliveredAs: z.string().min(1).optional(),
  deliveredAt: z.number().optional(),
  /** How often the sending session's pass has sent it again, and when last. */
  resent: z.object({ n: z.number().int().min(1), at: z.number() }).optional(),
  /** When the sending session was told it was refused or couldn't be delivered. */
  toldAt: z.number().optional(),
  /** When it was sent, in ms. */
  at: z.number()
});

export type WorkerMessageRow = z.infer<typeof workerMessageRowSchema>;

