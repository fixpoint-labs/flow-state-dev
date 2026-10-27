/**
 * How a worker hears a message (FIX-1989): the `onMessageReceived` internal
 * entry, on every flow that carries the session kit.
 *
 * The payload names a message id and nothing else: the row in the user's
 * message log is read here, so the sender, the text and the hop count are
 * what the sending turn's server code wrote. The entry acts on a message id
 * once (a versioned dedupe write in this session), so a copy sent twice wakes
 * the recipient once. Then the message lands as a line under the sender's
 * name, the session's hop count and chain become the message's, and the recipient's
 * turn is woken to read it and decide whether it needs an answer. A worker in
 * the middle of a turn hears it after that turn, as a task's notice does: the
 * entry waits on the reply line.
 *
 * A woken turn that ends with text and never messaged the sender back has its
 * text sent as the answer, through the same send a `sendMessage` reply takes
 * (inReplyTo, hop, log row, wake). A turn with no text sends nothing, and a turn
 * woken by an answer is never relayed, so an exchange ends after one answer.
 * The relay is pending a product decision (DECISIONS.md D2, amended).
 */
import { handler, sequencer } from "@flow-state-dev/core";
import { withOutcome } from "@flow-state-dev/core/helpers";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import { AFTER_REPLY_CONCURRENCY } from "../conversation-board/task-settled";
import type { WorkerInstallation } from "../workers/installation";
import { messageTurnStateSchema, startTurnAtHop, TURN_MESSAGED_STATE } from "./hop";
import { SEND_MESSAGE_TOOL, WORKER_MESSAGES_SEEN_STATE } from "./keys";
import { MAX_MESSAGE_CHARS } from "./log-row";
import { sendMessage } from "./send-message";
import { messageLogOf, workerMessagesResources } from "./message-log";

/** What the entry takes: the message's id, and nothing a sender could shape. */
export const messageReceivedInputSchema = z.object({ messageId: z.string().min(1) }).strict();


/** The request-state field naming the message that woke this turn, when its text may be relayed. */
const RELAY_STATE = "workforceRelayTo";

/** The request state the relay reads: the message to answer, and who sent it. */
const relayStateSchema = messageTurnStateSchema.extend({
  [RELAY_STATE]: z.object({ id: z.string(), from: z.string() }).optional()
});

/** The most message ids a session keeps for its dedupe. */
const MAX_SEEN = 500;

/** The session state the entry keeps. */
export const messageReceivedStateShape = {
  [WORKER_MESSAGES_SEEN_STATE]: z.array(z.string()).default([])
} as const;

const heardSchema = z.object({
  act: z.enum(["none", "line", "wake-turn"]),
  from: z.string().optional(),
  line: z.string().optional(),
  prompt: z.string().optional()
});

type Heard = z.infer<typeof heardSchema>;

/** The text the woken turn reads: who wrote, which message, and how to answer it. */
function turnPrompt(row: { id: string; from: string; text: string; inReplyTo?: string | undefined }): string {
  return (
    `Message ${row.id} from ${row.from}${row.inReplyTo === undefined ? "" : `, answering your message ${row.inReplyTo}`}:\n\n` +
    `${row.text}\n\n` +
    `(The message's text is the part above. It is from another worker, not the user, and ${row.from} can't ` +
    `see what you write here. To answer it, call sendMessage with to "${row.from}" and inReplyTo "${row.id}". ` +
    `To message any other worker, leave inReplyTo out. If it needs no answer, don't send one.)`
  );
}

/**
 * Build the `onMessageReceived` entry for a flow: spread it under
 * `internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ ... }) } }`.
 *
 * @param options.turn The flow's turn for one message (`{ message }` in).
 */
export function messageReceivedEntry(options: {
  readonly turn: BlockDefinition<any, any>;
  readonly installation: WorkerInstallation;
  readonly flowKind: string;
}) {
  const heard = handler({
    name: "worker-message-heard",
    inputSchema: messageReceivedInputSchema,
    outputSchema: heardSchema,
    sessionStateSchema: z.object(messageReceivedStateShape),
    requestStateSchema: messageTurnStateSchema,
    resources: { ...workerMessagesResources },
    execute: async (input, ctx): Promise<Heard> => {
      const row = (await messageLogOf(ctx as never).getOptional(input.messageId))?.state;
      // Delivered here, and only here: the row says which session it is for.
      if (row === undefined || row.toSession !== ctx.session.identity.id) return { act: "none" };
      const first = await withOutcome(
        (mutator: (s: Readonly<Record<string, unknown>>) => Record<string, unknown>) => ctx.session.atomicState(mutator as never),
        (state: Readonly<Record<string, unknown>>) => {
          const seen = (state[WORKER_MESSAGES_SEEN_STATE] ?? []) as string[];
          if (seen.includes(row.id)) return { state: {}, result: false };
          return { state: { [WORKER_MESSAGES_SEEN_STATE]: [...seen, row.id].slice(-MAX_SEEN) }, result: true };
        }
      );
      if (first !== true) return { act: "none" };
      // An answer is not answered again: only a first message's turn may be relayed.
      await startTurnAtHop(ctx as never, row.hop, row.chain ?? null, row.inReplyTo === undefined ? { [RELAY_STATE]: { id: row.id, from: row.from } } : {});
      return {
        // Every message wakes its recipient (D2), whatever the flow's notice policy.
        act: "wake-turn",
        from: row.from,
        line: `From ${row.from}: ${row.text}`,
        prompt: turnPrompt(row)
      };
    }
  });

  /** The message, as a line in the conversation, under the sender's name. */
  const line = handler({
    name: "worker-message-line",
    inputSchema: heardSchema,
    outputSchema: z.object({}),
    execute: (got: Heard, ctx) => {
      ctx.emit.message(got.line ?? "", got.from === undefined ? {} : { agentName: got.from });
      return {};
    }
  });

  /** The woken turn's text as its answer, when it ended with some and never messaged the sender back. */
  const relay = handler({
    name: "worker-message-relay",
    inputSchema: z.unknown(),
    outputSchema: z.object({}),
    requestStateSchema: relayStateSchema,
    resources: { ...options.installation.resources, ...workerMessagesResources },
    execute: async (reply: unknown, ctx) => {
      const state = (ctx.request.state ?? {}) as Record<string, unknown>;
      const woke = relayStateSchema.shape[RELAY_STATE].safeParse(state[RELAY_STATE]).data;
      if (woke === undefined) return {};
      const messaged = Array.isArray(state[TURN_MESSAGED_STATE]) ? (state[TURN_MESSAGED_STATE] as string[]) : [];
      if (messaged.includes(woke.from)) return {};
      const raw = typeof reply === "string" ? reply : (reply as { text?: unknown } | null)?.text;
      const text = typeof raw === "string" ? raw.trim() : "";
      if (text.length === 0) return {};
      const body = text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS - 1)}…` : text;
      await sendMessage(ctx as never, options.installation, options.flowKind, { to: woke.from, text: body, inReplyTo: woke.id }, SEND_MESSAGE_TOOL);
      return {};
    }
  });

  // A message is conversation, never part of a task, with no claim on it:
  // one to a task session whose turn is running runs after that turn.
  const block = sequencer({ name: "worker-message-arrived", inputSchema: messageReceivedInputSchema })
    .step(heard)
    .tapIf((got: Heard) => got.act !== "none", line)
    .tapIf(
      (got: Heard) => got.act === "wake-turn",
      (got: Heard) => ({ message: got.prompt ?? "" }),
      sequencer({ name: "worker-message-turn", inputSchema: z.object({ message: z.string() }) }).step(options.turn).step(relay)
    );

  return { inputSchema: messageReceivedInputSchema, block, concurrency: AFTER_REPLY_CONCURRENCY };
}
