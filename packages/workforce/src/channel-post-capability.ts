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
 * record id, the name a channel's `members:` lists. A seat whose settings
 * carry none is refused by name, never posted as the request's principal,
 * because a post with no author skips the channel's member check and wakes
 * every member.
 *
 * ## One gate
 *
 * The line is written by the built-in channel kind's own `post`, which checks
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
 * tool's first post into that post's channel is the answer's line; a later
 * one posts nothing and says the answer is already in. The claim is keyed on
 * the post's id in the seat's session, which the kind's own landing reads
 * too, so a turn that posted through the tool lands nothing more. Any other
 * turn, and any other channel, posts as before.
 */

import { defineCapability, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import type { DefinedCapability } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { CHANNEL_KIND } from "./channel/channel-flow";
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
 * The seat-session field recording the routed posts the seat has answered in
 * that channel: a map from post id to `true`. Never trimmed, so a post
 * delivered again however late lands no second line. It grows by one id per
 * routed answer, beside a conversation that already keeps every turn.
 */
export const ANSWERED_POSTS_STATE = "channelAnsweredPosts";

/** The answered map, or an empty one when the session has none yet. */
function answeredPosts(state: Readonly<Record<string, unknown>> | undefined): Record<string, true> {
  const held = state?.[ANSWERED_POSTS_STATE];
  return typeof held === "object" && held !== null && !Array.isArray(held) ? (held as Record<string, true>) : {};
}

/** A routed turn's mark: the channel and the post it answers. */
export const routedTurnSchema = z.object({ channelId: z.string(), postId: z.string() });

export type RoutedTurn = z.infer<typeof routedTurnSchema>;

/**
 * The routed post this turn answers, or `undefined` on any other turn.
 *
 * @param ctx Any block's context in the turn's request.
 */
export function routedTurnOf(ctx: BlockContext): RoutedTurn | undefined {
  const marked = (ctx.request.state as Record<string, unknown> | undefined)?.[ROUTED_TURN_STATE];
  const parsed = routedTurnSchema.safeParse(marked);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Whether the seat already has its line for this post, in this session.
 *
 * @param ctx A block's context in the seat's channel session.
 * @param postId The routed post's line id.
 */
export function answeredAlready(ctx: BlockContext, postId: string): boolean {
  return Object.hasOwn(answeredPosts(ctx.session.state as Record<string, unknown> | undefined), postId);
}

/**
 * Claim the one line for a routed post, in the seat's session. Atomic, so two
 * claims racing for one post see one winner.
 *
 * @param ctx A block's context in the seat's channel session.
 * @param postId The routed post's line id.
 * @returns `true` for the claim that gets to post; `false` when the seat already has its line.
 */
export async function claimRoutedAnswer(ctx: BlockContext, postId: string): Promise<boolean> {
  return ctx.session.atomicState((state: Readonly<Record<string, unknown>>) => {
    const answered = answeredPosts(state);
    if (Object.hasOwn(answered, postId)) return {};
    return { [ANSWERED_POSTS_STATE]: { ...answered, [postId]: true } };
  });
}

/**
 * One dispatch into the named channel's own `post`, as the seat. The author is
 * the seat's `seatId`, read from the settings the hire wrote and stamped in
 * the payload, so a seat without one throws before anything is dispatched.
 * `{ id }`: a channel is an existing session. The tool and the agent kind's
 * landing both post through it, so a line has one way in.
 */
export const postAsSeat = dispatcher({
  name: "post-to-channel-dispatch",
  flowKind: CHANNEL_KIND,
  action: "post",
  inputSchema: postToChannelInputSchema,
  session: { id: (input: PostToChannelInput) => input.channel },
  payload: (input: PostToChannelInput, ctx) => {
    const seatId = (ctx.flow.config as Record<string, unknown>)[SEAT_ID_KEY];
    if (typeof seatId !== "string" || seatId.length === 0) {
      throw new Error(
        `${POST_TO_CHANNEL_TOOL}: this seat's settings carry no \`${SEAT_ID_KEY}\`, so there is no ` +
          `name to post under. The hire step writes it on every seat it mints. Nothing was posted.`,
      );
    }
    return { body: input.body, author: seatId };
  },
});

/**
 * On a routed turn, and only into that post's channel: claim the post's one
 * line. Claimed before the dispatch, so two calls in one step cannot both post.
 */
const claimToolLine = handler({
  name: "post-to-channel-claim",
  inputSchema: postToChannelInputSchema,
  outputSchema: z.object({ channel: z.string(), body: z.string(), answeredAlready: z.boolean() }),
  execute: async (input: PostToChannelInput, ctx) => {
    const routed = routedTurnOf(ctx);
    if (routed === undefined || routed.channelId !== input.channel) {
      return { ...input, answeredAlready: false };
    }
    return { ...input, answeredAlready: !(await claimRoutedAnswer(ctx, routed.postId)) };
  },
});

/**
 * The tool: one dispatch into the named channel's own `post`, then "handed
 * over"; or, for a routed post the seat already answered, nothing and a note
 * saying so.
 */
const postToChannel = sequencer({
  name: POST_TO_CHANNEL_TOOL,
  description:
    "Post a line to a channel you are a member of, under your own name. " +
    "`channel` is the channel's id, as the post that woke you names it.",
  inputSchema: postToChannelInputSchema,
  outputSchema: postToChannelResultSchema,
})
  .step(claimToolLine)
  .stepIf(
    (claim: { answeredAlready: boolean }) => !claim.answeredAlready,
    (claim: PostToChannelInput) => ({ channel: claim.channel, body: claim.body }),
    postAsSeat,
  )
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
          note: "Your answer to this post is already in the channel, so nothing more was posted.",
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
