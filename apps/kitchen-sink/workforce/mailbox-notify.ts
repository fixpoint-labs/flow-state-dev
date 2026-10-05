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
 * The wake is Workforce's `wakeMemberSeats`, over the app's live registry,
 * with nothing of this app's added: every member of `support.help` is an agent
 * seat that hears posts, so there is no member to stand in for. On a routed
 * mailbox the route has already picked who hears a post, and the wake runs
 * that seat alone. A seat's own post wakes nobody. The goal checks' two wake
 * controls wrap it here, from `lib/mailbox-wake-control.ts`, and never reach
 * the package.
 */
import type { BlockDefinition } from "@flow-state-dev/core";
import { wakeMemberSeats, type MailboxWorkerSource } from "@flow-state-dev/workforce";

import { withMailboxWakeControl } from "../lib/mailbox-wake-control";

/**
 * The notify block for the hired roster: the wake for each member whose seat
 * can hear a post.
 *
 * @param seats The workers to wake: a getter over the registry, read once per
 *   post so a worker hired while the app runs is woken, or a fixed list.
 * @returns The block `defineMailboxFlow({ notify })` runs once per member per post.
 */
export function notifyFor(seats: MailboxWorkerSource): BlockDefinition<any, any> {
  return withMailboxWakeControl(wakeMemberSeats(seats));
}
