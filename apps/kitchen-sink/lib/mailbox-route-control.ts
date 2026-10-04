/**
 * The goal checks' control for a mailbox's route (`GOAL_CONTROL=no-route`).
 *
 * Takes the `routing:` lines off every mailbox as it is read, before the
 * mailboxes are bound, so `support.help` is a plain mailbox again: every
 * member hears every post, and nothing lands on its own. A check that one
 * specialist answers and nobody else runs must FAIL under it.
 *
 * Honoured only under `KITCHEN_SINK_TEST_MODE=1` (`goalControl`), so a control
 * can never reach a deployed build.
 */
import type { MailboxManifest } from "@flow-state-dev/workforce";

import { goalControl } from "./goal-control";

/** The mailboxes as read, or with their `routing:` removed when the control is on. */
export function withMailboxRouteControl(mailboxes: MailboxManifest[]): MailboxManifest[] {
  if (goalControl() !== "no-route") return mailboxes;
  return mailboxes.map(({ declared: { routing: _routing, ...declared }, ...rest }) => ({ ...rest, declared }));
}
