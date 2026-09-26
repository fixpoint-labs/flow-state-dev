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
 */

import { defineCapability, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext, DefinedCapability } from "@flow-state-dev/core";
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

const signedPostSchema = z.object({ channel: z.string(), body: z.string(), author: z.string() });

/** The seat's own id, from the settings the hire wrote; refused by name when absent. */
const signPost = handler({
  name: "post-to-channel-sign",
  inputSchema: postToChannelInputSchema,
  outputSchema: signedPostSchema,
  execute: (input: PostToChannelInput, ctx: BlockContext) => {
    const seatId = (ctx.flow.config as Record<string, unknown>)[SEAT_ID_KEY];
    if (typeof seatId !== "string" || seatId.length === 0) {
      throw new Error(
        `${POST_TO_CHANNEL_TOOL}: this seat's settings carry no \`${SEAT_ID_KEY}\`, so there is no ` +
          `name to post under. The hire step writes it on every seat it mints. Nothing was posted.`,
      );
    }
    return { channel: input.channel, body: input.body, author: seatId };
  },
});

/** The dispatch into the named channel's own `post`. `{ id }`: a channel is an existing session. */
const dispatchPost = dispatcher({
  name: "post-to-channel-dispatch",
  flowKind: CHANNEL_KIND,
  action: "post",
  inputSchema: signedPostSchema,
  session: { id: (input: z.infer<typeof signedPostSchema>) => input.channel },
  payload: (input: z.infer<typeof signedPostSchema>) => ({ body: input.body, author: input.author }),
});

/** What the model is told: handed over, not posted. */
const handedOver = handler({
  name: "post-to-channel-handed-over",
  inputSchema: z.object({ sessionId: z.string() }).passthrough(),
  outputSchema: z.object({ handedTo: z.string(), note: z.string() }),
  execute: (dispatched: { sessionId: string }) => ({
    handedTo: dispatched.sessionId,
    note:
      "The post was handed to the channel. It lands if you are one of its members; " +
      "a refusal by the channel is not reported back.",
  }),
});

/** The tool. The model supplies the channel and the words; the author is the seat's. */
const postToChannel = sequencer({
  name: POST_TO_CHANNEL_TOOL,
  description:
    "Post a line to a channel you are a member of, under your own name. " +
    "`channel` is the channel's id, as the post that woke you names it.",
  inputSchema: postToChannelInputSchema,
})
  .step(signPost)
  .step(dispatchPost)
  .step(handedOver);

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
