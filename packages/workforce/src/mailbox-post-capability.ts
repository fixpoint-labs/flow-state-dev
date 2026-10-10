/**
 * `mailboxPostCapability` — an agent seat posts into a mailbox it belongs to,
 * as itself.
 *
 * Compose it into a worker kind's `uses` and the kind's catalog gains one
 * tool, `post-to-mailbox`. That is a grant the kind offers, not one a seat
 * holds: a seat names the tool in its `tools:` before the model can call it,
 * the same fence the roster's `hire` sits behind as a tool. Posting is an
 * effect other people read, so it is never a control every seat holds.
 *
 * ## Who the line is from
 *
 * The model chooses the mailbox and the words, and nothing else: the input is
 * closed, so an `author` from the model is refused. The author is the seat's
 * `seatId`, which the hire step writes into every seat's settings: the seat's
 * record id, the name a mailbox's `members:` lists. The tool declares it as
 * the flow config it requires, so a seat whose settings carry none is refused
 * by name before the model is offered the tool, never posted as the request's
 * principal. The line's `author` is that `seatId`: the roster check and the
 * name on the line. It is not what withholds member wakes. The post goes
 * through the mailbox's `seatPost` action, and that action is what marks
 * the line a seat's. A dispatched `post` does not.
 *
 * ## One gate
 *
 * The line is written by the built-in mailbox kind's `seatPost`, or for a
 * routed post's answer its `answer`, which checks the line as `post` does:
 * membership against the mailbox as opened. The tool checks nothing of its
 * own. A dispatch into another session starts a request there and returns, so
 * the tool reports that it handed the post over, not that it landed: a mailbox
 * that refuses the author (`author-not-a-member`) refuses on its own request,
 * and the seat's turn goes on. A refusal the dispatch returns at once fails
 * the call by name: an id nobody opened (`session-not-found`), a session of
 * another mailbox kind (`session-not-addressable`), or a host whose dispatcher
 * hands work to an external queue with no shared lease backend
 * (`external-dispatcher`), where a delivery into an existing session is
 * refused before anything is enqueued. So the tool works where dispatch runs
 * in process, or where queue workers share a lease backend.
 *
 * ## One line per routed post
 *
 * On a turn the built-in agent kind marks as answering a routed post, the
 * tool's post into that post's mailbox is the post's answer, and goes to the
 * mailbox's `answer`. The mailbox keeps one answer per post, the first whose
 * line it keeps, so every hand-off can simply try: a second, from this turn or
 * from the post delivered again, lands nothing. Once the turn has handed its
 * answer over, a later call posts nothing and says so. Handed over means the
 * mailbox took the hand-off, not that it kept the line: the dispatch returns
 * before the mailbox writes. So the kind's own landing still hands the turn's
 * reply over, which lands only when the tool's answer did not. Nothing is
 * claimed on the seat's side, so a hand-off the dispatch refuses writes
 * nothing anywhere: the tool's next call, the landing, or the post delivered
 * again can still answer it. Any other turn, and any other mailbox, posts as
 * before.
 */

import { verifiedWorkerOf } from "./workers/verified-worker";
import { defineCapability, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import type { DefinedCapability } from "@flow-state-dev/core";
import { z } from "zod";
import { MAILBOX_ANSWER_ACTION, MAILBOX_KIND, MAILBOX_SEAT_POST_ACTION } from "./mailbox/mailbox-flow";
import { SEAT_ID_KEY } from "./manifest";

/** The capability name a worker file spells under `capabilities:`. */
export const MAILBOX_POST_CAPABILITY = "mailbox-post";

/** The tool's name, which a worker file types in `tools:`. */
export const POST_TO_MAILBOX_TOOL = "post-to-mailbox";

/** What the model sends: the mailbox's id and the words. Closed: there is nowhere to put an author. */
export const postToMailboxInputSchema = z
  .object({
    /** The mailbox's id, as a woken turn names it (`<writer> in <mailbox>: <body>`). */
    mailbox: z.string().min(1),
    body: z.string().min(1),
  })
  .strict();

export type PostToMailboxInput = z.infer<typeof postToMailboxInputSchema>;

const postToMailboxResultSchema = z.object({ handedTo: z.string(), note: z.string() });

/**
 * The request-state field the built-in agent kind marks a routed turn with:
 * the mailbox and the post the turn answers. Written only by the kind's own
 * `onMailboxPost`, from the mailbox fan-out's delivery, never from a caller.
 */
export const ROUTED_TURN_STATE = "mailboxRoutedPost";

/**
 * A routed turn's mark: the mailbox and the post it answers, and `handed` once
 * the mailbox has taken a hand-off of the post's answer from this turn, which
 * does not say it kept the line.
 */
export const routedTurnSchema = z.object({
  mailboxId: z.string(),
  postId: z.string(),
  handed: z.literal(true).optional(),
});

/**
 * The request state a block reads the mark from, for its `requestStateSchema`.
 * Absent on every turn but a routed one; nothing else writes the field, so a
 * block reads it as declared.
 */
export const routedTurnStateSchema = z.object({ [ROUTED_TURN_STATE]: routedTurnSchema.optional() });

/**
 * What a block that posts as the seat requires of the seat's settings: its
 * `seatId`, which the hire step writes on every seat it mints. Declared as the
 * block's `flowConfigSchema`, so a seat without one is refused before it can
 * post: at the mint when the block is reachable from the kind, and when a
 * generator resolves the tool.
 */
export const seatIdConfigSchema = z.object({ [SEAT_ID_KEY]: z.string().min(1) });

/**
 * The worker a turn on a copy that runs every worker signs as: the one the
 * turn loaded with `resolveWorker`. Refuses a turn that loaded none, since a
 * line nobody signed can't be posted as a worker.
 */
export function workerIdOfTurn(ctx: { readonly session: object }): string {
  const workerId = verifiedWorkerOf(ctx.session);
  if (workerId === undefined) throw new Error("This turn loaded no worker, so it can't post as one.");
  return workerId;
}

/**
 * Who a line is signed by: `copy`, the `seatId` of a copy minted for one
 * worker, checked against the copy's config before the model is offered the
 * tool; `worker`, the worker the turn loaded on a copy that runs every worker.
 */
type Signer = "copy" | "worker";

/** What {@link postAsSeat} is handed: the tool's input, and the seat's name to post under. */
const postAsSeatInputSchema = z.object({ mailbox: z.string(), body: z.string(), author: z.string() });

type PostAsSeatInput = z.infer<typeof postAsSeatInputSchema>;

/**
 * One dispatch into the named mailbox's own `post`, as the seat. The author is
 * the seat's `seatId`, read by the block before it, which declares it.
 * `{ id }`: a mailbox is an existing session.
 */
const postAsSeat = dispatcher({
  name: "post-to-mailbox-dispatch",
  flowKind: MAILBOX_KIND,
  action: MAILBOX_SEAT_POST_ACTION,
  inputSchema: postAsSeatInputSchema,
  session: { id: (input: PostAsSeatInput) => input.mailbox },
  payload: (input: PostAsSeatInput) => ({ body: input.body, author: input.author }),
});

/** What {@link answerRoutedPost} is handed: a routed post's answer, as the seat. */
const answerAsSeatInputSchema = postAsSeatInputSchema.extend({ postId: z.string() });

type AnswerAsSeatInput = z.infer<typeof answerAsSeatInputSchema>;

/**
 * One dispatch into the post's mailbox's own `answer`, as the seat. The
 * mailbox keeps the post's first kept answer and lands no other.
 */
const answerAsSeat = dispatcher({
  name: "answer-in-mailbox-dispatch",
  flowKind: MAILBOX_KIND,
  action: MAILBOX_ANSWER_ACTION,
  inputSchema: answerAsSeatInputSchema,
  session: { id: (input: AnswerAsSeatInput) => input.mailbox },
  payload: (input: AnswerAsSeatInput) => ({
    postId: input.postId,
    body: input.body,
    author: input.author,
  }),
});

/**
 * Mark the routed turn `handed`, once the mailbox has taken the hand-off of
 * its answer. Taken, not kept: the dispatch starts the mailbox's request and
 * returns, so the mailbox can still refuse the line after this. Nothing is
 * marked for a hand-off the dispatch refused, which throws first.
 */
const markHanded = handler({
  name: "answer-in-mailbox-mark",
  inputSchema: z.unknown(),
  outputSchema: z.object({}),
  requestStateSchema: routedTurnStateSchema,
  execute: async (_handedOver: unknown, ctx) => {
    // Reached only on a routed turn, which is marked.
    await ctx.request.patchState({ [ROUTED_TURN_STATE]: { ...ctx.request.state.mailboxRoutedPost!, handed: true as const } });
    return {};
  },
});

/**
 * A routed turn's answer: one dispatch into the mailbox's `answer`, then the
 * turn marked `handed`. The tool and the agent kind's landing both answer
 * through it, so a routed post's answer has one way in.
 */
export const answerRoutedPost = sequencer({ name: "answer-in-mailbox", inputSchema: answerAsSeatInputSchema })
  .step(answerAsSeat)
  .tap(markHanded);

/**
 * What the tool's call is against the turn's routed post: the post's
 * `answer`, a plain `post` (not a routed turn, or another mailbox), or
 * nothing because the turn has `answered` it.
 */
type ToolLine = PostAsSeatInput & { postId?: string; as: "answer" | "post" | "answered" };

/** The tool's line as the seat, and what it is against the turn's routed post. */
const toolLineFor = (signer: Signer) => handler({
  name: "post-to-mailbox-line",
  inputSchema: postToMailboxInputSchema,
  outputSchema: postAsSeatInputSchema.extend({
    postId: z.string().optional(),
    as: z.enum(["answer", "post", "answered"]),
  }),
  requestStateSchema: routedTurnStateSchema,
  ...(signer === "copy" ? { flowConfigSchema: seatIdConfigSchema } : {}),
  execute: async (input: PostToMailboxInput, ctx): Promise<ToolLine> => {
    const author =
      signer === "copy" ? String((ctx.flow.config as Record<string, unknown>)[SEAT_ID_KEY]) : workerIdOfTurn(ctx);
    const line = { ...input, author };
    const routed = ctx.request.state.mailboxRoutedPost;
    if (routed === undefined || routed.mailboxId !== input.mailbox) return { ...line, as: "post" };
    if (routed.handed === true) return { ...line, as: "answered" };
    return { ...line, postId: routed.postId, as: "answer" };
  },
});

/** The line, as {@link postAsSeat} takes it. */
const toPost = (line: ToolLine): PostAsSeatInput => ({ mailbox: line.mailbox, body: line.body, author: line.author });

/** The line, as {@link answerRoutedPost} takes it. */
const toAnswer = (line: ToolLine): AnswerAsSeatInput => ({
  ...toPost(line),
  postId: line.postId!,
});

/**
 * The tool: one dispatch into the named mailbox, then "handed over"; or, for
 * a routed post whose answer the turn has handed over already, nothing and a
 * note saying so.
 */
const postToMailboxFor = (signer: Signer) => sequencer({
  name: POST_TO_MAILBOX_TOOL,
  description:
    "Post a line to a mailbox you are a member of, under your own name. " +
    "`mailbox` is the mailbox's id, as the post that woke you names it.",
  inputSchema: postToMailboxInputSchema,
  outputSchema: postToMailboxResultSchema,
})
  .step(toolLineFor(signer))
  .stepIf((line: ToolLine) => line.as === "answer", toAnswer, answerRoutedPost)
  .stepIf((value: ToolLine | { sessionId: string }) => "as" in value && value.as === "post", toPost, postAsSeat)
  .map((value: { sessionId: string } | { mailbox: string }) =>
    "sessionId" in value
      ? {
          handedTo: value.sessionId,
          note:
            "The post was handed to the mailbox. It lands if you are one of its members; " +
            "a refusal by the mailbox is not reported back.",
        }
      : {
          handedTo: value.mailbox,
          note: "Your answer to this post was already handed to the mailbox, so nothing more was posted.",
        },
  );

/**
 * The mailbox-post capability: one catalog tool, `post-to-mailbox`, on the
 * default `tools` preset. Compose it into a kind's `uses`; a seat names the
 * tool in `tools:` to use it.
 */
export const mailboxPostCapability: DefinedCapability = defineCapability({
  name: MAILBOX_POST_CAPABILITY,
  presets: {
    tools: { tools: [postToMailboxFor("copy")] },
    default: ["tools"],
  },
});

/**
 * The same capability for a copy that runs every worker, which has no
 * `seatId` of its own: each line is signed by the worker the turn loaded.
 * `defineAgentWorkerFlow({ installation })` puts it in place of
 * {@link mailboxPostCapability}; an app's own worker flow on an installation
 * uses it directly.
 */
export const workerMailboxPostCapability: DefinedCapability = defineCapability({
  name: MAILBOX_POST_CAPABILITY,
  presets: {
    tools: { tools: [postToMailboxFor("worker")] },
    default: ["tools"],
  },
});
