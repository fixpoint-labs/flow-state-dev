/**
 * `channelPostCapability` — one catalog tool, `post-to-channel`.
 *
 * Compose it into a worker kind's `uses`. A seat names the tool in `tools:`
 * before the model can call it. The model sends `{ channel, body }` (closed).
 * The author is the seat's `seatId`, stamped in the dispatch payload. The
 * line is written by the channel kind's own `post`. A refusal the dispatch
 * returns at once fails the call; a refusal the channel makes on its own
 * request does not.
 */

import { defineCapability, dispatcher, sequencer } from "@flow-state-dev/core";
import type { DefinedCapability } from "@flow-state-dev/core";
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

const postToChannelResultSchema = z.object({
  handedTo: z.string(),
  note: z.string(),
});

const postToChannel = sequencer({
  name: POST_TO_CHANNEL_TOOL,
  description:
    "Post a line to a channel you are a member of, under your own name. " +
    "`channel` is the channel's id, as the post that woke you names it.",
  inputSchema: postToChannelInputSchema,
  outputSchema: postToChannelResultSchema,
})
  .step(
    dispatcher({
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
    }),
  )
  .map((dispatched: { sessionId: string }) => ({
    handedTo: dispatched.sessionId,
    note:
      "The post was handed to the channel. It lands if you are one of its members; " +
      "a refusal by the channel is not reported back.",
  }));

/**
 * The channel-post capability: `post-to-channel` on the default `tools` preset.
 */
export const channelPostCapability: DefinedCapability = defineCapability({
  name: CHANNEL_POST_CAPABILITY,
  presets: {
    tools: { tools: [postToChannel] },
    default: ["tools"],
  },
});
