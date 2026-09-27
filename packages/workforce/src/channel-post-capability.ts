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
 *
 * The claim is taken before the hand-off, so two posts racing for one line
 * see one winner, and given back when the hand-off is not accepted: a refusal
 * the dispatch returns leaves the post unanswered, so the tool's next call,
 * the landing, or the post delivered again can still answer it. A hand-off the
 * channel accepted and then refused on its own request keeps the claim, as it
 * is not reported back.
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

/**
 * The request state a block reads the mark from, for its `requestStateSchema`.
 * Absent on every turn but a routed one; nothing else writes the field, so a
 * block reads it as declared.
 */
export const routedTurnStateSchema = z.object({ [ROUTED_TURN_STATE]: routedTurnSchema.optional() });

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
 * claims racing for one post see one winner. The winner posts through
 * {@link postRoutedAnswer}, which gives the claim back if the hand-off is not
 * accepted.
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
 * `{ id }`: a channel is an existing session. The tool and the agent kind's
 * landing both post through it (a routed answer through
 * {@link postRoutedAnswer}, which wraps it), so a line has one way in.
 */
const postAsSeat = dispatcher({
  name: "post-to-channel-dispatch",
  flowKind: CHANNEL_KIND,
  action: "post",
  inputSchema: postAsSeatInputSchema,
  session: { id: (input: PostAsSeatInput) => input.channel },
  payload: (input: PostAsSeatInput) => ({ body: input.body, author: input.author }),
});

/**
 * Give the routed post's claim back, then rethrow: the hand-off it was taken
 * for failed before the channel accepted it, so the post has no line. Only the
 * claim's holder reaches this, and nobody else can take a held claim, so the
 * entry it removes is its own. The failure stays the turn's.
 */
const giveBackClaim = handler({
  name: "post-to-channel-give-back-claim",
  inputSchema: z.unknown(),
  outputSchema: z.never(),
  requestStateSchema: routedTurnStateSchema,
  execute: async (error: unknown, ctx): Promise<never> => {
    // Reached only after a claim on a routed turn, which is marked.
    await ctx.session.deleteStateRecord(ANSWERED_POSTS_STATE, ctx.request.state.channelRoutedPost!.postId);
    throw error;
  },
});

/**
 * {@link postAsSeat} for the holder of a routed post's claim: the dispatch
 * refuses only when it did not hand the post over, and then the claim is given
 * back. Never used without the claim, or a failed dispatch into another
 * channel would give back a line that already landed.
 */
export const postRoutedAnswer = postAsSeat.rescue([{ block: giveBackClaim }]);

/**
 * How the tool's call stands against the turn's routed post: it `claimed` the
 * post's line, it is `unrouted` (not a routed turn, or another channel), or
 * the seat has its line already (`answered`).
 */
type ToolClaim = PostAsSeatInput & { claim: "claimed" | "unrouted" | "answered" };

/**
 * On a routed turn, and only into that post's channel: claim the post's one
 * line. Claimed before the dispatch, so two calls in one step cannot both post.
 */
const claimToolLine = handler({
  name: "post-to-channel-claim",
  inputSchema: postToChannelInputSchema,
  outputSchema: postAsSeatInputSchema.extend({ claim: z.enum(["claimed", "unrouted", "answered"]) }),
  requestStateSchema: routedTurnStateSchema,
  flowConfigSchema: seatIdConfigSchema,
  execute: async (input: PostToChannelInput, ctx): Promise<ToolClaim> => {
    const post = { ...input, author: ctx.flow.config.seatId };
    const routed = ctx.request.state.channelRoutedPost;
    if (routed === undefined || routed.channelId !== input.channel) return { ...post, claim: "unrouted" };
    return { ...post, claim: (await claimRoutedAnswer(ctx, routed.postId)) ? "claimed" : "answered" };
  },
});

/** The claim's post, as {@link postAsSeat} takes it. */
const toPost = (claim: ToolClaim): PostAsSeatInput => ({ channel: claim.channel, body: claim.body, author: claim.author });

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
  .stepIf((claim: ToolClaim) => claim.claim === "claimed", toPost, postRoutedAnswer)
  .stepIf(
    (value: ToolClaim | { sessionId: string }) => "claim" in value && value.claim === "unrouted",
    toPost,
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
