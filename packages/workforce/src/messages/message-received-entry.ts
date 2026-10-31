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
 * Except a message that asks for a reply (FIX-2310, `./owed-replies`): the turn
 * owes one answer. When the turn ends without one, the framework sends its
 * final text back through that same `sendMessage`, as this worker, or a "no
 * answer" when the turn said nothing, threw, or runs no turn. A sender that
 * waits for it (`wait: true`, FIX-2318) parks on this request, and reads that
 * answer off the log once the request ends; the turn reads the same prompt
 * either way.
 *
 * The request's output is the turn's final text, `{ reply }`, once it landed
 * a message; one that acted on nothing (a copy) outputs no reply, and an
 * entry with no turn outputs `{ turnless: true }`. Between the take and the
 * items, a message to a session stopped for the user, or to a task held on
 * one, queues until nothing holds it (`./queue`).
 */
import { handler, sequencer } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import { AFTER_REPLY_CONCURRENCY } from "../conversation-board/task-settled";
import type { WorkerInstallation } from "../workers/installation";
import { conversationLedgerResources } from "../conversation-board/ledger";
import { messageTurnStateSchema, RECEIVED_REPLY_OWED_STATE, RECEIVED_LANDED_STATE, startTurnAtHop } from "./hop";
import { sendOwedReply, wantsReply, oweReply, type NoAnswerReason } from "./owed-replies";
import { carriesPass, markDelivered, storedEmitters, takeMessage } from "./delivery";
import { MESSAGE_RECEIVED_ENTRY, RECEIVED_MESSAGE_COMPONENT, SEND_MESSAGE_TOOL } from "./keys";
import { messageLimitsOf } from "./message-limits";
import { MAX_MESSAGE_CHARS, messageChainsOf, workerMessagesResources } from "./message-log";
import { queueBehindUser } from "./queue";
import { messageHearingOf, RECEIVED_MARK, type MessageHearing, type ReceivedMark } from "./received-mark";
import { sendQuestionToFiler } from "./midway-question";
import { wakeHeldWait } from "./wait-for-reply";

/** What the entry takes: the message's id, and nothing a sender could shape. */
export const messageReceivedInputSchema = z.object({ messageId: z.string().min(1) }).strict();

/** What a flow's turn hears: every field from the message's row and its chain, none from a sender's input. */
export const messageReceivedSchema = z.object({
  /** The message's id: what an answer names as `inReplyTo`. */
  id: z.string(),
  /** The worker that sent it, as the server recorded it. */
  from: z.string(),
  text: z.string(),
  /**
   * Whether the sender asked for a reply (FIX-2310), waiting for it or not:
   * the turn's final text goes back to it as this worker's answer, unless the
   * turn answers with `sendMessage` itself. Absent reads as no.
   */
  replyRequested: z.boolean().optional(),
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
    "or spread the session factory's `board.entries(turn)`.";
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
  if (received.replyRequested === true) {
    return (
      `Message ${received.id} from ${received.from}${received.inReplyTo === undefined ? "" : `, answering your message ${received.inReplyTo}`}: they asked for a reply.\n\n` +
      `${received.text}\n\n` +
      `(The message's text is the part above. It is from another worker, not the user, and ${received.from} can't ` +
      `see what you write here. Your reply here goes back to ${received.from} as your answer when this turn ends, so ` +
      `answer it directly in your reply. If you answer with ${SEND_MESSAGE_TOOL} and inReplyTo "${received.id}" instead, ` +
      `nothing more is sent. To message any other worker, leave inReplyTo out.)`
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

/** What an `onMessageReceived` request outputs: the reply, when it landed a message and ran a turn on it; `turnless` when it landed one with no turn to run. */
const messageReceivedOutputSchema = z.object({ reply: z.string().optional(), turnless: z.literal(true).optional() });

/**
 * Build the `onMessageReceived` entry for a flow: spread it under
 * `internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ ... }) } }`.
 * The session factory's `entries(turn)` spreads it already.
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
      // The answer a wait in this session still holds (FIX-2318): it wakes that wait, as the
      // wait's result, and lands as nothing here. Not woken yet: left taken by this request,
      // which ends, so the answer's sender's pass sends it again.
      const wake = await wakeHeldWait(ctx as never, row);
      if (wake === "retry") return { act: "none" };
      if (wake === "woken") {
        await markDelivered(ctx as never, row.id);
        return { act: "none" };
      }
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
        ...(wantsReply(row) ? { replyRequested: true } : {}),
        ...(row.inReplyTo === undefined ? {} : { inReplyTo: row.inReplyTo }),
        budget: Math.max(0, budget - Math.max(row.hop, chainSent))
      };
      // The two items, in one place, after the take: the line the model
      // reads, and the item an app draws.
      const emit = storedEmitters(ctx as never);
      // A `user` line: the sender's words, which the recipient's model must
      // not read as something it already said.
      await emit.message(`From ${row.from}: ${row.text}`, { role: "user", agentName: row.from, itemVisibility: { client: false, history: true } });
      await emit.component(
        RECEIVED_MESSAGE_COMPONENT,
        {
          id: row.id,
          from: row.from,
          text: row.text,
          ...(row.inReplyTo === undefined ? {} : { inReplyTo: row.inReplyTo }),
          budget: received.budget,
          ...(wantsReply(row) ? { replyRequested: true } : {}),
          ...(row.noAnswer === true ? { noAnswer: true } : {})
        },
        { agentName: row.from, itemVisibility: { client: true, history: false } }
      );
      // Landed once both are stored: the sending session's pass stops sending
      // it. A taker killed before this is taken over, and the message shows twice.
      await emit.stored();
      // A reply-requested message owes an answer from here (FIX-2310), owed
      // before it reads delivered: the pass answers it if this request dies
      // before its end does, even right after the delivery.
      if (wantsReply(row) && carriesPass(options.installation, options.flowKind)) await oweReply(ctx as never, row.id);
      await markDelivered(ctx as never, row.id);
      await ctx.request.atomicState(() => ({
        [RECEIVED_LANDED_STATE]: true,
        ...(wantsReply(row) ? { [RECEIVED_REPLY_OWED_STATE]: row.id } : {})
      }));
      return { act: "heard", received };
    }
  });

  /**
   * Send the reply owed to the message this request landed, if it owes one (FIX-2310): `text`,
   * or "no answer" for `reason` when it is blank. A turn that ran and gave
   * none is logged: the sender hears only that nothing came back.
   */
  const replyOwedHere = async (ctx: Parameters<typeof sendOwedReply>[0], text: string, reason: NoAnswerReason) => {
    const owed = (ctx.request.state as Record<string, unknown> | undefined)?.[RECEIVED_REPLY_OWED_STATE];
    if (typeof owed !== "string") return;
    if (text.trim() === "" && reason !== "turnless") {
      console.warn("[workforce] a reply-requested message's turn ended with no answer to send", { messageId: owed, reason, flowKind: options.flowKind });
    }
    await sendOwedReply(ctx, options.installation, options.flowKind, owed, text, reason);
  };

  // The request's output: the turn's final text, cut to a message's length
  // (BP-042), once it landed one. A reply-requested message is answered with it.
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
      // A turnless landing answers blank: "no answer".
      const reply = options.turn === undefined ? "" : replyTextOf(input);
      await replyOwedHere(ctx as never, reply, options.turn === undefined ? "turnless" : "silent");
      // Landed, and nothing ran on it: no reply, not an empty one.
      if (options.turn === undefined) return { turnless: true as const };
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
  // A turn that throws still answers a reply-requested message it landed: "no answer", then the
  // error goes on as it would have. A suspension isn't rescued: the reply waits
  // with the turn.
  const failed = handler({
    name: "message-received-failed",
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    requestStateSchema: messageTurnStateSchema,
    resources: { ...workerMessagesResources },
    execute: async (error, ctx) => {
      await replyOwedHere(ctx as never, "", "failed");
      throw error;
    }
  });
  block = block.rescue([{ block: failed as never }]) as never;

  const entry = { inputSchema: messageReceivedInputSchema, block, concurrency: AFTER_REPLY_CONCURRENCY };
  const mark: ReceivedMark = {
    ...(options.hears === undefined ? {} : { hears: options.hears }),
    runsTurn: options.turn !== undefined,
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
