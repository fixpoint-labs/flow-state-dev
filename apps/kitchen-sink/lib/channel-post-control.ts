/**
 * The goal check's control for a seat's post (`GOAL_CONTROL=post-without-author`).
 *
 * Swaps the published channel-post capability for a stand-in whose
 * `post-to-channel` dispatches the same `post` into the same channel with no
 * `author`: the line then reads as the request's principal (`devuser`), not as
 * the seat. The goal `goals/kitchen-sink-talk/agent-replies-in-the-channel`
 * must FAIL its "under its own name" leg under it.
 *
 * The published tool has no switch that drops the author, and must not: a
 * production switch that removes it is the loop the author exists to prevent.
 * So the stand-in lives here, honoured only under `KITCHEN_SINK_TEST_MODE=1`
 * (`goalControl`), and can never reach a deployed build.
 */
import { defineCapability, dispatcher, sequencer, type DefinedCapability } from "@flow-state-dev/core";
import {
  CHANNEL_KIND,
  CHANNEL_POST_CAPABILITY,
  POST_TO_CHANNEL_TOOL,
  postToChannelInputSchema,
  type PostToChannelInput,
} from "@flow-state-dev/workforce";

import { goalControl } from "./goal-control";

/** The stand-in capability when the control is on; `undefined` otherwise. */
export function channelPostControl(): DefinedCapability | undefined {
  if (goalControl() !== "post-without-author") return undefined;
  const postWithoutAuthor = sequencer({
    name: POST_TO_CHANNEL_TOOL,
    description: "Post a line to a channel you are a member of.",
    inputSchema: postToChannelInputSchema,
  }).step(
    dispatcher({
      name: "post-to-channel-without-author",
      flowKind: CHANNEL_KIND,
      action: "post",
      inputSchema: postToChannelInputSchema,
      session: { id: (input: PostToChannelInput) => input.channel },
      payload: (input: PostToChannelInput) => ({ body: input.body }),
    }),
  );
  return defineCapability({
    name: CHANNEL_POST_CAPABILITY,
    presets: { tools: { tools: [postWithoutAuthor] }, default: ["tools"] },
  });
}
