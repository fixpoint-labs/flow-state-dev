/**
 * `channelPostCapability` — an agent seat posts into a channel it belongs to,
 * as itself.
 *
 * Compose it into a worker kind's `uses` and the kind's catalog gains one
 * tool, `post-to-channel`. That is a grant the kind offers, not one a seat
 * holds: a seat names the tool in its `tools:` before the model can call it,
 * the same fence `createSeatHireCapability`'s `hire` sits behind. Posting is an
 * effect other people read, so it is never a control every seat holds.
 *
 * ## Who the line is from
 *
 * The model chooses the channel and the words, and nothing else: the input is
 * closed, so an `author` from the model is refused. The author is the seat's
 * `seatId`, which the hire step writes into every seat's settings: the seat's
 * record id, the name a channel's `members:` lists. The tool declares it as
 * the flow config it requires, so a seat whose settings carry none is refused
 * by name before the model is offered the tool, never posted as the request's
 * principal: a post with no author skips the channel's member check and wakes
 * every member.
 *
 * ## One gate
 *
 * The line is written by the built-in channel kind's own `post`, or for a
 * routed post's answer its `answer`, which checks the line as `post` does:
 * membership against the channel as opened. The tool checks nothing of its
 * own. A dispatch into another session starts a request there and returns, so
 * the tool reports that it handed the post over, not that it landed: a channel
 * that refuses the author (`author-not-a-member`) refuses on its own request,
 * and the seat's turn goes on. A refusal the dispatch returns at once fails
 * the call by name: an id nobody opened (`session-not-found`), a session of
 * another channel kind (`session-not-addressable`), or a host whose dispatcher
 * hands work to an external queue (`external-dispatcher`), where a delivery
 * into an existing session is refused before anything is enqueued. So the
 * tool works where dispatch runs in process.
 *
 * ## One line per routed post
 *
 * On a turn the built-in agent kind marks as answering a routed post, the
 * tool's post into that post's channel is the post's answer, and goes to the
 * channel's `answer`. The channel keeps one answer per post, the first whose
 * line it keeps, so every hand-off can simply try: a second, from this turn or
 * from the post delivered again, lands nothing. Once the turn has handed its
 * answer over, a later call posts nothing and says so. Handed over means the
 * channel took the hand-off, not that it kept the line: the dispatch returns
 * before the channel writes. So the kind's own landing still hands the turn's
 * reply over, which lands only when the tool's answer did not. Nothing is
 * claimed on the seat's side, so a hand-off the dispatch refuses writes
 * nothing anywhere: the tool's next call, the landing, or the post delivered
 * again can still answer it. Any other turn, and any other channel, posts as
 * before.
 */

import { defineCapability, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import type { DefinedCapability } from "@flow-state-dev/core";
import { z } from "zod";
import { CHANNEL_ANSWER_ACTION, CHANNEL_KIND } from "./channel/channel-flow";
import { SEAT_ID_KEY } from "./manifest";

/** The capability name a worker file spells under `capabilities:`. */
export const CHANNEL_POST_CAPABILITY = "channel-post";

/** The tool's name, which a worker file types in `tools:`. */
export const POST_TO_CHANNEL_TOOL = "post-to-channel";

/** What the model sends: the channel's id and the words. Closed: there is nowhere to put an author. */
export const postToChannelInputSchema = z
  .object({
    /** The channel's id, as a woken turn names it (`<writer> in <channel>: <body>`). */
    channel: z.string().min(1),
    body: z.string().min(1),
  })
  .strict();

export type PostToChannelInput = z.infer<typeof postToChannelInputSchema>;

const postToChannelResultSchema = z.object({ handedTo: z.string(), note: z.string() });

/**
 * The request-state field the built-in agent kind marks a routed turn with:
 * the channel and the post the turn answers. Written only by the kind's own
 * `onChannelPost`, from the channel fan-out's delivery, never from a caller.
 */
export const ROUTED_TURN_STATE = "channelRoutedPost";

/**
 * A routed turn's mark: the channel and the post it answers, and `handed` once
 * the channel has taken a hand-off of the post's answer from this turn, which
 * does not say it kept the line.
 */
export const routedTurnSchema = z.object({
  channelId: z.string(),
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

/** What {@link postAsSeat} is handed: the tool's input, and the seat's name to post under. */
const postAsSeatInputSchema = z.object({ channel: z.string(), body: z.string(), author: z.string() });

type PostAsSeatInput = z.infer<typeof postAsSeatInputSchema>;

/**
 * One dispatch into the named channel's own `post`, as the seat. The author is
 * the seat's `seatId`, read by the block before it, which declares it.
 * `{ id }`: a channel is an existing session.
 */
const postAsSeat = dispatcher({
  name: "post-to-channel-dispatch",
  flowKind: CHANNEL_KIND,
  action: "post",
  inputSchema: postAsSeatInputSchema,
  session: { id: (input: PostAsSeatInput) => input.channel },
  payload: (input: PostAsSeatInput) => ({ body: input.body, author: input.author }),
});

/** What {@link answerRoutedPost} is handed: a routed post's answer, as the seat. */
const answerAsSeatInputSchema = postAsSeatInputSchema.extend({ postId: z.string() });

type AnswerAsSeatInput = z.infer<typeof answerAsSeatInputSchema>;

/**
 * One dispatch into the post's channel's own `answer`, as the seat. The
 * channel keeps the post's first kept answer and lands no other.
 */
const answerAsSeat = dispatcher({
  name: "answer-in-channel-dispatch",
  flowKind: CHANNEL_KIND,
  action: CHANNEL_ANSWER_ACTION,
  inputSchema: answerAsSeatInputSchema,
  session: { id: (input: AnswerAsSeatInput) => input.channel },
  payload: (input: AnswerAsSeatInput) => ({ postId: input.postId, body: input.body, author: input.author }),
});

/**
 * Mark the routed turn `handed`, once the channel has taken the hand-off of
 * its answer. Taken, not kept: the dispatch starts the channel's request and
 * returns, so the channel can still refuse the line after this. Nothing is
 * marked for a hand-off the dispatch refused, which throws first.
 */
const markHanded = handler({
  name: "answer-in-channel-mark",
  inputSchema: z.unknown(),
  outputSchema: z.object({}),
  requestStateSchema: routedTurnStateSchema,
  execute: async (_handedOver: unknown, ctx) => {
    // Reached only on a routed turn, which is marked.
    await ctx.request.patchState({ [ROUTED_TURN_STATE]: { ...ctx.request.state.channelRoutedPost!, handed: true as const } });
    return {};
  },
});

/**
 * A routed turn's answer: one dispatch into the channel's `answer`, then the
 * turn marked `handed`. The tool and the agent kind's landing both answer
 * through it, so a routed post's answer has one way in.
 */
export const answerRoutedPost = sequencer({ name: "answer-in-channel", inputSchema: answerAsSeatInputSchema })
  .step(answerAsSeat)
  .tap(markHanded);

/**
 * What the tool's call is against the turn's routed post: the post's
 * `answer`, a plain `post` (not a routed turn, or another channel), or
 * nothing because the turn has `answered` it.
 */
type ToolLine = PostAsSeatInput & { postId?: string; as: "answer" | "post" | "answered" };

/** The tool's line as the seat, and what it is against the turn's routed post. */
const toolLine = handler({
  name: "post-to-channel-line",
  inputSchema: postToChannelInputSchema,
  outputSchema: postAsSeatInputSchema.extend({
    postId: z.string().optional(),
    as: z.enum(["answer", "post", "answered"]),
  }),
  requestStateSchema: routedTurnStateSchema,
  flowConfigSchema: seatIdConfigSchema,
  execute: async (input: PostToChannelInput, ctx): Promise<ToolLine> => {
    const line = { ...input, author: ctx.flow.config.seatId };
    const routed = ctx.request.state.channelRoutedPost;
    if (routed === undefined || routed.channelId !== input.channel) return { ...line, as: "post" };
    return routed.handed === true ? { ...line, as: "answered" } : { ...line, postId: routed.postId, as: "answer" };
  },
});

/** The line, as {@link postAsSeat} takes it. */
const toPost = (line: ToolLine): PostAsSeatInput => ({ channel: line.channel, body: line.body, author: line.author });

/** The line, as {@link answerRoutedPost} takes it. */
const toAnswer = (line: ToolLine): AnswerAsSeatInput => ({ ...toPost(line), postId: line.postId! });

/**
 * The tool: one dispatch into the named channel, then "handed over"; or, for
 * a routed post whose answer the turn has handed over already, nothing and a
 * note saying so.
 */
const postToChannel = sequencer({
  name: POST_TO_CHANNEL_TOOL,
  description:
    "Post a line to a channel you are a member of, under your own name. " +
    "`channel` is the channel's id, as the post that woke you names it.",
  inputSchema: postToChannelInputSchema,
  outputSchema: postToChannelResultSchema,
})
  .step(toolLine)
  .stepIf((line: ToolLine) => line.as === "answer", toAnswer, answerRoutedPost)
  .stepIf((value: ToolLine | { sessionId: string }) => "as" in value && value.as === "post", toPost, postAsSeat)
  .map((value: { sessionId: string } | { channel: string }) =>
    "sessionId" in value
      ? {
          handedTo: value.sessionId,
          note:
            "The post was handed to the channel. It lands if you are one of its members; " +
            "a refusal by the channel is not reported back.",
        }
      : {
          handedTo: value.channel,
          note: "Your answer to this post was already handed to the channel, so nothing more was posted.",
        },
  );

/**
 * The channel-post capability: one catalog tool, `post-to-channel`, on the
 * default `tools` preset. Compose it into a kind's `uses`; a seat names the
 * tool in `tools:` to use it.
 */
export const channelPostCapability: DefinedCapability = defineCapability({
  name: CHANNEL_POST_CAPABILITY,
  presets: {
    tools: { tools: [postToChannel] },
    default: ["tools"],
  },
});
