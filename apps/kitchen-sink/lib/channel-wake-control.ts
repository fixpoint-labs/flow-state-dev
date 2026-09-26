/**
 * The goal checks' controls for the channel wake (`GOAL_CONTROL`).
 *
 * - `name-only-notify` puts back the notify block every member got before the
 *   wake existed: a name-only line, and no seat runs. The goal
 *   `goals/kitchen-sink-talk/a-post-runs-each-member-agent-once` must FAIL
 *   under it.
 * - `no-author-filter` drops the wake's author filter, so a post a seat wrote
 *   wakes the agent members too. A check that a seat's own post runs no seat
 *   must FAIL under it.
 *
 * Honoured only under `KITCHEN_SINK_TEST_MODE=1` (`goalControl`), so a control
 * can never reach a deployed build. A test seam, kept in `lib/` so the notify
 * block does not import from `test/`.
 */
import { goalControl } from "./goal-control";

/** The channel-wake control in force, or `undefined` when none is. */
export function channelWakeControl(): "name-only-notify" | "no-author-filter" | undefined {
  const control = goalControl();
  return control === "name-only-notify" || control === "no-author-filter" ? control : undefined;
}
