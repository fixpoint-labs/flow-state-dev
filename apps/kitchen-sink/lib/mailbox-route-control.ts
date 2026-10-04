/**
 * The goal checks' control for a channel's route (`GOAL_CONTROL=no-route`).
 *
 * Takes the `routing:` lines off every channel as it is read, before the
 * channels are bound, so `support.help` is a plain channel again: every
 * member hears every post, and nothing lands on its own. A check that one
 * specialist answers and nobody else runs must FAIL under it.
 *
 * Honoured only under `KITCHEN_SINK_TEST_MODE=1` (`goalControl`), so a control
 * can never reach a deployed build.
 */
import type { ChannelManifest } from "@flow-state-dev/workforce";

import { goalControl } from "./goal-control";

/** The channels as read, or with their `routing:` removed when the control is on. */
export function withChannelRouteControl(channels: ChannelManifest[]): ChannelManifest[] {
  if (goalControl() !== "no-route") return channels;
  return channels.map(({ declared: { routing: _routing, ...declared }, ...rest }) => ({ ...rest, declared }));
}
