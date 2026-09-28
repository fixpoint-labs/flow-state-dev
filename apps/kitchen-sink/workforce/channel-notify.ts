/**
 * The fan-out slot the built-in channel kind is built with.
 *
 * Here rather than under `flows/channels/`, and that is the point: this is a
 * block handed to the framework's own factory, not a channel kind of this
 * app's own. `fsdev gen` walks `flows/channels/` and would have put a file
 * there on the generated `channelKinds` map, where the binder would have read
 * it as a kind a `CHANNEL.md` can name in its `flow:` line. The top level of
 * `workforce/` is not walked, so a block that belongs to the built-in lives
 * here and stays off that map.
 *
 * The wake is Workforce's `wakeMemberSeats`, over the seats hired at boot,
 * with nothing of this app's added: every member of `support.help` is an agent
 * seat that hears posts, so there is no member to stand in for. On a routed
 * channel the route has already picked who hears a post, and the wake runs
 * that seat alone. A seat's own post wakes nobody. The goal checks' two wake
 * controls wrap it here, from `lib/channel-wake-control.ts`, and never reach
 * the package.
 */
import type { BlockDefinition } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { wakeMemberSeats } from "@flow-state-dev/workforce";

import { withChannelWakeControl } from "../lib/channel-wake-control";

/**
 * The notify block for the hired roster: the wake for each member whose seat
 * can hear a post.
 *
 * @param seats The seats hired at boot.
 * @returns The block `defineChannelFlow({ notify })` runs once per member per post.
 */
export function notifyFor(seats: readonly FlowInstance[]): BlockDefinition<any, any> {
  return withChannelWakeControl(wakeMemberSeats(seats));
}
