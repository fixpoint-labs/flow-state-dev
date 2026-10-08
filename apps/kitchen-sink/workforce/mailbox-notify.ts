/**
 * The fan-out slot the built-in mailbox kind is built with.
 *
 * Here rather than under `flows/mailboxes/`, and that is the point: this is a
 * block handed to the framework's own factory, not a mailbox kind of this
 * app's own. `fsdev gen` walks `flows/mailboxes/` and would have put a file
 * there on the generated `mailboxKinds` map, where the binder would have read
 * it as a kind a `MAILBOX.md` can name in its `flow:` line. The top level of
 * `workforce/` is not walked, so a block that belongs to the built-in lives
 * here and stays off that map.
 *
 * The wake is Workforce's `wakeMemberSeats`, over the copies registered at
 * boot, with nothing of this app's added: every member of `support.help` is a
 * standard worker on `agent`, which hears posts, so there is no member to
 * stand in for. Each member wakes in a conversation of its own on the one
 * `agent` copy. On a routed mailbox the route has already picked who hears a
 * post, and the wake runs that worker alone. A worker's own post wakes nobody.
 * The goal checks' two wake controls wrap it here, from
 * `lib/mailbox-wake-control.ts`, and never reach the package.
 */
import type { BlockDefinition } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { wakeMemberSeats, type WorkerInstallation } from "@flow-state-dev/workforce";

import { withMailboxWakeControl } from "../lib/mailbox-wake-control";

/**
 * The notify block: the wake for each member that can hear a post.
 *
 * @param copies The copies registered at boot.
 * @param installation The installation whose standard workers the members are.
 * @returns The block `defineMailboxFlow({ notify })` runs once per member per post.
 */
export function notifyFor(copies: readonly FlowInstance[], installation: WorkerInstallation): BlockDefinition<any, any> {
  return withMailboxWakeControl(wakeMemberSeats(copies, { installation }));
}
