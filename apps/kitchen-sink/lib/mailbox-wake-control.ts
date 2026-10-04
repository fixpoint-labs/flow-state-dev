/**
 * The goal checks' controls for the channel wake (`GOAL_CONTROL`).
 *
 * - `name-only-notify` puts back the notify block every member got before the
 *   wake existed: a name-only line, and no seat runs. The goal
 *   `goals/kitchen-sink-talk/a-post-runs-each-member-agent-once` must FAIL
 *   under it.
 * - `no-author-filter` hands the wake each delivery with its `seatAuthored`
 *   mark dropped, so a post a seat wrote wakes the agent members too. A check
 *   that a seat's own post runs no seat must FAIL under it. The name is the
 *   control the checks already set; the mark they drop is the one the wake
 *   reads.
 *
 * Both wrap Workforce's `wakeMemberSeats` from outside: the package has no
 * switch for either, and a test control never reaches it.
 *
 * Honoured only under `KITCHEN_SINK_TEST_MODE=1` (`goalControl`), so a control
 * can never reach a deployed build. A test seam, kept in `lib/` so the notify
 * block does not import from `test/`.
 */
import { handler, type BlockDefinition } from "@flow-state-dev/core";
import { channelNotifyInputSchema, type ChannelNotifyInput } from "@flow-state-dev/workforce";
import { z } from "zod";

import { goalControl } from "./goal-control";

/** The channel-wake control in force, or `undefined` when none is. */
function channelWakeControl(): "name-only-notify" | "no-author-filter" | undefined {
  const control = goalControl();
  return control === "name-only-notify" || control === "no-author-filter" ? control : undefined;
}

/**
 * `name-only-notify`'s stand-in: a transient line naming the member, and no
 * seat runs. Nobody is told about their own post.
 */
const nameOnly = handler({
  name: "kitchen-sink-notify-member",
  inputSchema: channelNotifyInputSchema,
  outputSchema: z.object({ notified: z.string() }),
  execute: (input: ChannelNotifyInput, ctx) => {
    if (input.author !== undefined && input.member === input.author) return { notified: "" };
    ctx.emit.message(`[${input.channelId}] → ${input.member}: ${input.body}`, { transient: true });
    return { notified: input.member };
  },
});

/**
 * The notify block with the control in force applied: `wake` unchanged when
 * none is, the name-only stand-in in its place under `name-only-notify`, and
 * `wake` fed deliveries with the seat mark dropped under `no-author-filter`.
 */
export function withChannelWakeControl(wake: BlockDefinition<any, any>): BlockDefinition<any, any> {
  const control = channelWakeControl();
  if (control === "name-only-notify") return nameOnly;
  if (control === "no-author-filter") {
    return wake.connectInput(({ seatAuthored: _seatAuthored, ...post }: ChannelNotifyInput) => post);
  }
  return wake;
}
