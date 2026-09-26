/**
 * The goal checks' controls for the channel wake (`GOAL_CONTROL`).
 *
 * - `name-only-notify` puts back the notify block every member got before the
 *   wake existed: a name-only line, and no seat runs. The goal
 *   `goals/kitchen-sink-talk/a-post-runs-each-member-agent-once` must FAIL
 *   under it.
 * - `no-author-filter` hands the wake each delivery with its `author` dropped,
 *   so a post a seat wrote wakes the agent members too. A check that a seat's
 *   own post runs no seat must FAIL under it.
 *
 * Both wrap Workforce's `wakeMemberSeats` from outside: the package has no
 * switch for either, and a test control never reaches it.
 *
 * Honoured only under `KITCHEN_SINK_TEST_MODE=1` (`goalControl`), so a control
 * can never reach a deployed build. A test seam, kept in `lib/` so the notify
 * block does not import from `test/`.
 */
import type { BlockDefinition } from "@flow-state-dev/core";
import type { ChannelNotifyInput } from "@flow-state-dev/workforce";

import { goalControl } from "./goal-control";

/** The channel-wake control in force, or `undefined` when none is. */
function channelWakeControl(): "name-only-notify" | "no-author-filter" | undefined {
  const control = goalControl();
  return control === "name-only-notify" || control === "no-author-filter" ? control : undefined;
}

/**
 * The notify block with the control in force applied: `wake` unchanged when
 * none is, `nameOnly` in its place under `name-only-notify`, and `wake` fed
 * author-less deliveries under `no-author-filter`.
 */
export function withChannelWakeControl(
  wake: BlockDefinition<any, any>,
  nameOnly: BlockDefinition<any, any>,
): BlockDefinition<any, any> {
  const control = channelWakeControl();
  if (control === "name-only-notify") return nameOnly;
  if (control === "no-author-filter") {
    return wake.connectInput(({ author: _author, ...post }: ChannelNotifyInput) => post);
  }
  return wake;
}
