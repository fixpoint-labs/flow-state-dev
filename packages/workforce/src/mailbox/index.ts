/**
 * The mailbox floor: the built-in kind, the two-phase binder that turns mailbox
 * records into one registered instance per kind and one named session per
 * mailbox, and the boards a mailbox holds.
 *
 * A board is a task ledger a `MAILBOX.md` declares by local name and the
 * framework mints an id for. The mailbox HOLDS it — files rows onto it and
 * reads it — and never runs it; draining stays on the seat's side, which is
 * what `mailboxBoard` and `mailboxBoardTaskTools` are for.
 *
 * No `node:fs` here — reading a `MAILBOX.md` off disk is the `./loader`
 * subpath's job. Not browser-safe, though: the boards reach the orchestration
 * task board and `node:async_hooks`. What a page needs of a post lives in
 * `./mailbox-post-line.ts`, re-exported from `../browser.ts`.
 */

export { emitMailboxPostLine, readMailboxPostLines } from "./mailbox-items";

export {
  MAILBOX_KIND,
  MAILBOX_SEAT_POST_ACTION,
  MAILBOX_POST_COMPONENT,
  MailboxPostRefusedError,
  INVENTORY_REGISTER_MAILBOX,
  INVENTORY_REGISTER_SEATS,
  INVENTORY_RETIRE_MAILBOXES,
  inventoryMailboxRegisteredSchema,
  inventorySeatsRegisteredSchema,
  inventoryWriterActions,
  mailboxFileTaskInputSchema,
  mailboxFileTaskOutputSchema,
  mailboxFlow,
  mailboxNotifyInputSchema,
  mailboxPostInputSchema,
  mailboxBoardRowSchema,
  mailboxReadBoardInputSchema,
  mailboxReadBoardOutputSchema,
  mailboxReadOutputSchema,
  mailboxSessionStateSchema,
  mailboxTranscriptLineSchema,
  defineMailboxFlow,
  type MailboxFileTaskInput,
  type MailboxFileTaskOutput,
  type MailboxFlowFactory,
  type MailboxNotifyInput,
  type MailboxPostInput,
  type MailboxReadBoardOutput,
  type MailboxReadOutput,
  type MailboxRefusalReason,
  type MailboxSessionState,
  type MailboxTranscriptLine,
  type DefineMailboxFlowOptions
} from "./mailbox-flow";

export { taskListWorkers } from "./mailbox-membership";

export { wakeMemberSeats, type WakeMemberSeatsOptions } from "./wake-member-seats";

export { routeByPurpose, type RouteByPurposeOptions } from "./route-by-purpose";

export {
  MAILBOX_ROUTE_COMPONENT,
  MAILBOX_ROUTE_EVALUATOR,
  mailboxRouteRecordSchema,
  type MailboxRoute,
  type MailboxRouteRecord,
  type MailboxRouting
} from "./mailbox-route";

export {
  mailboxBoardIds,
  mailboxInstances,
  openMailboxes,
  type MailboxInstancesOptions,
  type MailboxKind,
  type OpenMailboxesOptions
} from "./mailbox-binder";

export {
  PRE_RENAME_NAMES,
  describePreRenameMarks,
  findPreRenameMarks,
  type PreRenameMarks,
  type PreRenameStoreView
} from "./pre-rename";

export {
  mailboxBoard,
  mailboxBoardTaskTools,
  type MailboxBoardCollection
} from "./mailbox-board";

export {
  REFUSED_SYSTEM_KEY,
  REFUSED_SYSTEM_KEY_MESSAGE,
  type MailboxManifest
} from "../manifest";
