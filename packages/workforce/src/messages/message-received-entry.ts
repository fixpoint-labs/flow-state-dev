/**
 * How a worker hears a message (FIX-1989, FIX-2238): the `onMessageReceived`
 * internal entry, on every worker flow. The hire refuses a worker flow
 * without it ({@link messageReceivedProblem}).
 *
 * The payload names a message id and nothing else: the row in the user's
 * message log is read here, so the sender, the text and the budget are what
 * the sending turn's server code wrote. The entry takes the message on its
 * row before anything lands (`delivery.ts`, FIX-2240), so a copy sent again,
 * at any distance, wakes the recipient once, and a copy that finds the taker
 * ended without delivering takes over. Then the message lands as two items: a line the model reads
 * in its history, and a client-only `workforce:received` component carrying
 * the sender, the id and the message it answers, for an app to draw, and the
 * row is marked `delivered`. The
 * session's hop count and chain become the message's, and the flow's turn,
 * when it has one, runs with {@link MessageReceived} as its input. A worker in
 * the middle of a turn hears it after that turn, as a task's notice does: the
 * entry waits on the reply line.
 *
 * Nothing is relayed: a woken worker that wants to answer sends one with
 * `sendMessage` and `inReplyTo`, and one that ends in plain text answers no one.
 *
 * Except a call (FIX-2239): its sender waits on this request, so the request's
 * output is the reply, `{ reply }`, the final text of the turn, which comes
 * back to the sender as its tool's result. Every request that lands a message
 * outputs it, and only a call's sender reads it; one that acted on nothing
 * (a copy) outputs no reply. Between the take and the items, a message to a
 * session stopped for the user, or to a task held on one, queues until
 * nothing holds it (`./queue`).
 */
import { handler, sequencer } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import { AFTER_REPLY_CONCURRENCY } from "../conversation-board/task-settled";
import type { WorkerInstallation } from "../workers/installation";
import { conversationLedgerResources } from "../conversation-board/ledger";
import { messageTurnStateSchema, RECEIVED_CALL_STATE, RECEIVED_LANDED_STATE, startTurnAtHop } from "./hop";
import { markDelivered, storedEmitters, takeMessage } from "./delivery";
import { MESSAGE_RECEIVED_ENTRY, RECEIVED_MESSAGE_COMPONENT, SEND_MESSAGE_TOOL } from "./keys";
import { messageLimitsOf } from "./message-limits";
import { MAX_MESSAGE_CHARS, messageChainsOf, messageLogOf, workerMessagesResources } from "./message-log";
import { queueBehindUser } from "./queue";
import { messageHearingOf, RECEIVED_MARK, type MessageHearing, type ReceivedMark } from "./received-mark";
import { sendQuestionToFiler } from "./midway-question";

/** What the entry takes: the message's id, and nothing a sender could shape. */
export const messageReceivedInputSchema = z.object({ messageId: z.string().min(1) }).strict();

/** What a flow's turn hears: every field from the message's row and its chain, none from a sender's input. */
export const messageReceivedSchema = z.object({
  /** The message's id: what an answer names as `inReplyTo`. */
  id: z.string(),
  /** The worker that sent it, as the server recorded it. */
  from: z.string(),
  text: z.string(),
  /** Whether the sender waits on this turn's result (a call, FIX-2239): the turn's final text is its reply. */
  call: z.boolean(),
  /** The message this one answers, when it is an answer. */
  inReplyTo: z.string().optional(),
  /** How many more messages the exchange may send after this one. */
  budget: z.number().int().nonnegative()
});

/** {@link messageReceivedSchema}'s type. */
export type MessageReceived = z.infer<typeof messageReceivedSchema>;

export type { MessageHearing } from "./received-mark";

/**
 * Why `name`'s flow can't hear a message, or `undefined` when it can: its
 * internal `onMessageReceived` was built by {@link messageReceivedEntry} and
 * takes `{ messageId }`. The hire's check, beside `respond`'s.
 *
 * @param name The worker flow's name, for the sentence.
 * @param flow The worker flow's definition.
 */
export function messageReceivedProblem(name: string, flow: unknown): string | undefined {
  const entry = (flow as { internal?: { actions?: Record<string, unknown> } } | undefined)?.internal?.actions?.[MESSAGE_RECEIVED_ENTRY] as { inputSchema?: { safeParse?: (v: unknown) => { success: boolean } } } | undefined;
  const fix =
    `Build it with \`messageReceivedEntry\`: \`internal: { actions: { ${MESSAGE_RECEIVED_ENTRY}: messageReceivedEntry({ installation, flowKind }) } }\`, ` +
    "or spread the session kit's `board.entries(turn)`.";
  if (entry === undefined) {
    return `worker flow "${name}" has no "${MESSAGE_RECEIVED_ENTRY}", so no worker on it could hear another worker's message. ${fix}`;
  }
  if (messageHearingOf(flow) === undefined || entry.inputSchema?.safeParse?.({ messageId: "probe" }).success !== true) {
    return `worker flow "${name}" has a "${MESSAGE_RECEIVED_ENTRY}" that \`messageReceivedEntry\` didn't build. ${fix}`;
  }
  return undefined;
}

/**
 * The text a model's turn reads for a received message: who wrote, which
 * message, and how to answer it. For a flow whose turn takes `{ message }`.
 */
export function receivedMessagePrompt(received: MessageReceived): string {
  if (received.call) {
    return (
      `Call ${received.id} from ${received.from}: they are waiting for your answer.\n\n` +
      `${received.text}\n\n` +
      `(The call's text is the part above. It is from another worker, not the user. Your reply here goes back to ` +
      `${received.from} as the call's result, so answer it directly in your reply, and don't send ${received.from} ` +
      `a message with ${SEND_MESSAGE_TOOL}.)`
    );
  }
  return (
    `Message ${received.id} from ${received.from}${received.inReplyTo === undefined ? "" : `, answering your message ${received.inReplyTo}`}:\n\n` +
    `${received.text}\n\n` +
    `(The message's text is the part above. It is from another worker, not the user, and ${received.from} can't ` +
    `see what you write here. To answer it, call ${SEND_MESSAGE_TOOL} with to "${received.from}" and inReplyTo "${received.id}". ` +
    `To message any other worker, leave inReplyTo out. If it needs no answer, don't send one: not answering is an answer. ` +
    `${received.budget === 0 ? "No more messages can be sent in this exchange." : `This exchange can send ${received.budget} more message${received.budget === 1 ? "" : "s"}.`})`
  );
}

const heardSchema = z.object({
  act: z.enum(["none", "heard"]),
  received: messageReceivedSchema.optional()
});

type Heard = z.infer<typeof heardSchema>;

/**
 * A turn's final text: the turn's output when it is text (an agent worker's
 * answer), or its `reply` (a coder's talk turn). `""` for anything else.
 */
function replyTextOf(output: unknown): string {
  if (typeof output === "string") return output;
  const reply = (output as { reply?: unknown } | null | undefined)?.reply;
  return typeof reply === "string" ? reply : "";
}

/** What an `onMessageReceived` request outputs: the reply, when it landed a message. */
const messageReceivedOutputSchema = z.object({ reply: z.string().optional() });

/**
 * Build the `onMessageReceived` entry for a flow: spread it under
 * `internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ ... }) } }`.
 * The session kit's `entries(turn)` spreads it already.
 *
 * @param options.turn The flow's turn for a message ({@link MessageReceived}
 *   in). Absent, the message lands as its items and nothing runs.
 * @param options.hears Where the worker hears messages; see {@link MessageHearing}.
 */
export function messageReceivedEntry(options: {
  readonly turn?: BlockDefinition<any, any>;
  readonly installation: WorkerInstallation;
  readonly flowKind: string;
  readonly hears?: MessageHearing;
}) {
  const heard = handler({
    name: "message-received-heard",
    inputSchema: messageReceivedInputSchema,
    outputSchema: heardSchema,
    requestStateSchema: messageTurnStateSchema,
    // The conversation ledger tells whether a task session's task is held (`./queue`).
    resources: { ...workerMessagesResources, ...conversationLedgerResources },
    execute: async (input, ctx): Promise<Heard> => {
      // Delivered here, and only here (the row says which session it is
      // for), and only by the request that took it.
      const row = await takeMessage(ctx as never, input.messageId);
      if (row === undefined) return { act: "none" };
      // Queued behind the user's stop, before anything lands. Not admitted:
      // this request ends with the take, and a resend takes it over.
      if ((await queueBehindUser(ctx as never, row)) === "not_admitted") return { act: "none" };
      await startTurnAtHop(ctx as never, row.hop, row.chain ?? null);
      const { budget } = messageLimitsOf(options.installation);
      // What is left is the chain's, not the row's: sends since this one (a
      // branch, or a queue behind a busy recipient) have spent it too.
      const chainSent = row.chain == null ? 0 : ((await messageChainsOf(ctx as never).getOptional(row.chain))?.state.sent.length ?? 0);
      const received: MessageReceived = {
        id: row.id,
        from: row.from,
        text: row.text,
        call: row.call === true,
        ...(row.inReplyTo === undefined ? {} : { inReplyTo: row.inReplyTo }),
        budget: Math.max(0, budget - Math.max(row.hop, chainSent))
      };
      // The two items, in one place, after the take: the line the model
      // reads, and the item an app draws.
      const emit = storedEmitters(ctx as never);
      await emit.message(`From ${row.from}: ${row.text}`, { agentName: row.from, itemVisibility: { client: false, history: true } });
      await emit.component(
        RECEIVED_MESSAGE_COMPONENT,
        {
          id: row.id,
          from: row.from,
          text: row.text,
          ...(row.inReplyTo === undefined ? {} : { inReplyTo: row.inReplyTo }),
          budget: received.budget,
          call: received.call
        },
        { agentName: row.from, itemVisibility: { client: true, history: false } }
      );
      // Landed once both are stored: the sending session's pass stops sending
      // it. A taker killed before this is taken over, and the message shows twice.
      await emit.stored();
      await markDelivered(ctx as never, row.id);
      await ctx.request.atomicState(() => ({ [RECEIVED_LANDED_STATE]: true, ...(received.call ? { [RECEIVED_CALL_STATE]: row.id } : {}) }));
      return { act: "heard", received };
    }
  });

  // The request's output: the turn's final text, cut to a message's length
  // (BP-042), once it landed one. A call's row records when it was given.
  const replied = handler({
    name: "message-received-reply",
    inputSchema: z.unknown(),
    outputSchema: messageReceivedOutputSchema,
    requestStateSchema: messageTurnStateSchema,
    resources: { ...workerMessagesResources },
    execute: async (input, ctx) => {
      // Read off the request's state, which the heard step wrote: never off the
      // input's shape, which a turn's own output could match.
      const state = ctx.request.state as Record<string, unknown> | undefined;
      if (state?.[RECEIVED_LANDED_STATE] !== true) return {};
      const reply = options.turn === undefined ? "" : replyTextOf(input);
      const call = state[RECEIVED_CALL_STATE];
      if (typeof call === "string") await (await messageLogOf(ctx as never).getOptional(call))?.patchState({ repliedAt: Date.now() });
      return { reply: reply.slice(0, MAX_MESSAGE_CHARS) };
    }
  });

  // A message is conversation, never part of a task, with no claim on it:
  // one to a task session whose turn is running runs after that turn.
  let block = sequencer({ name: "message-received", inputSchema: messageReceivedInputSchema }).step(heard);
  if (options.turn !== undefined) {
    block = block.stepIf(
      (got: Heard) => got.act === "heard",
      (got: Heard) => got.received,
      options.turn
    ) as typeof block;
  }
  block = block.step(replied) as never;

  const entry = { inputSchema: messageReceivedInputSchema, block, concurrency: AFTER_REPLY_CONCURRENCY };
  const mark: ReceivedMark = {
    ...(options.hears === undefined ? {} : { hears: options.hears }),
    tellMidwayQuestion: (ctx, row, holds) => sendQuestionToFiler(ctx, { installation: options.installation, flowKind: options.flowKind }, row, holds)
  };
  (entry as Record<symbol, unknown>)[RECEIVED_MARK] = mark;
  return entry;
}

/**
 * A turn that takes `{ message }` as a turn for {@link messageReceivedEntry}:
 * its input is {@link receivedMessagePrompt}'s text.
 */
export function promptedMessageTurn(turn: BlockDefinition<any, any>, name = "message-received-turn") {
  return sequencer({ name, inputSchema: messageReceivedSchema })
    .step((received: MessageReceived) => ({ message: receivedMessagePrompt(received) }), turn);
}
