/**
 * The goal check's control for a seat's post (`GOAL_CONTROL=post-without-author`).
 *
 * Swaps the published mailbox-post capability for a stand-in whose
 * `post-to-mailbox` dispatches the same `post` into the same mailbox with no
 * `author`: the line then reads as the request's principal (`devuser`), not as
 * the seat. The goal `goals/kitchen-sink-talk/agent-replies-in-the-mailbox`
 * must FAIL its "under its own name" leg under it.
 *
 * The published tool has no switch that drops the author, and must not: the
 * name on the line is the seat's `seatId`. Dropping it is what this control
 * grades. Wakes stay withheld either way, because the dispatch is the seat
 * post action. The stand-in lives here, honoured only under `KITCHEN_SINK_TEST_MODE=1`
 * (`goalControl`), and can never reach a deployed build.
 */
import { defineCapability, dispatcher, sequencer, type DefinedCapability } from "@flow-state-dev/core";
import {
  MAILBOX_KIND,
  MAILBOX_SEAT_POST_ACTION,
  MAILBOX_POST_CAPABILITY,
  POST_TO_MAILBOX_TOOL,
  postToMailboxInputSchema,
  type PostToMailboxInput,
} from "@flow-state-dev/workforce";

import { goalControl } from "./goal-control";

/** The stand-in capability when the control is on; `undefined` otherwise. */
export function mailboxPostControl(): DefinedCapability | undefined {
  if (goalControl() !== "post-without-author") return undefined;
  const postWithoutAuthor = sequencer({
    name: POST_TO_MAILBOX_TOOL,
    description: "Post a line to a mailbox you are a member of.",
    inputSchema: postToMailboxInputSchema,
  }).step(
    dispatcher({
      name: "post-to-mailbox-without-author",
      flowKind: MAILBOX_KIND,
      action: MAILBOX_SEAT_POST_ACTION,
      inputSchema: postToMailboxInputSchema,
      session: { id: (input: PostToMailboxInput) => input.mailbox },
      payload: (input: PostToMailboxInput) => ({ body: input.body }),
    }),
  );
  return defineCapability({
    name: MAILBOX_POST_CAPABILITY,
    presets: { tools: { tools: [postWithoutAuthor] }, default: ["tools"] },
  });
}
