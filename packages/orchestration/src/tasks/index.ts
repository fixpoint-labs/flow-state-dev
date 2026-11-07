// FIX-443 / FIX-444.
/**
 * `@flow-state-dev/orchestration` — substrate package for task-shaped work
 * primitives.
 *
 * Exports the Task schema, the uniform `TaskCollectionRef` API across
 * both backings (atomic state, resource collection), the standard
 * claim order catalog, the worker contract, and the canonical helpers
 * for composing task loops inside sequencer patterns.
 *
 * Layering: `core` → `tasks` → `patterns`. Patterns consume this
 * package; this package never imports from `patterns`.
 */

// Schema
export {
  taskSchema,
  type Task,
  type TaskRunLink,
  type TaskStatus,
} from "./schema/task";
// A stored row read in the current shapes (BP-030): for a reader of raw stored rows, such as a browser's list.
export { withRetiredShapes } from "./schema/retired-shapes";
// What a task's runs spent (FIX-2288): the stored shape, and the fold a reader shows.
export {
  taskSpendSchema,
  taskSpendViewSchema,
  type TaskSpend,
  type TaskSpendView,
} from "./schema/spend";
export { spendAfterWrite, taskSpendView, type TaskSpendWrite } from "./spend";
export {
  taskStatusSchema,
  isTerminalStatus,
  isTransitionAllowed,
  allowedTransitionsFrom,
  IllegalTaskTransitionError,
} from "./schema/task-status";
export {
  type TaskInit,
  type TaskFilter,
  type TaskSessionSetting,
  type TaskResultSetting,
} from "./schema/task-init";
// What holds a task on its row (FIX-2133): one list of holds, and the one
// predicate every reader asks of it, open holds.
export {
  taskHoldSchema,
  rowHoldSchema,
  suspensionHoldSchema,
  type ConfirmOnNo,
  type ExternalWait,
  type ExternalWaitEvent,
  type QuestionInit,
  type RowHold,
  type SuspensionHold,
  type TaskHold,
} from "./schema/hold";
export {
  externalHoldOf,
  isExternalHold,
  openHolds,
  holdActorOf,
  type QuestionAnswer,
} from "./collection/holds";

// Filing settings and dependencies (FIX-2080): what a board refuses at filing,
// and the edit a filing takes until it starts.
export {
  TaskFilingRefusedError,
  type TaskFilingRule,
  type TaskSettingsSupport,
} from "./collection/filing";
export type { TaskSettingsPatch } from "./collection/internal";
// Steers (FIX-2086): words sent into an open task, kept on the task.
export { taskSteerSchema, type TaskSteer } from "./schema/steer";
export {
  type SteerInput,
} from "./steers";
// The field table (FIX-2081): each field `updateTask` changes, with its one rule.
export {
  TASK_FIELD_RULES,
  lockedFields,
  type TaskEditField,
} from "./collection/field-rules";

// The ownership token a task write presents (FIX-981). `ticketNamesTask` is the
// guard's own identity rule and stays module-internal — a caller mints a ticket
// and presents it; deciding whether one matches is the collection's job.
export {
  ticketForClaim,
  type TaskClaimTicket,
} from "./claim-ticket";

// Durable write provenance (FIX-989) — how a caller finds out whether its own
// write committed, after a call that threw. `stampWrite` is the backings' own
// convergence point and stays package-internal: provenance is maintained by the
// write, never by a caller.
export {
  beginTaskWrite,
  didWriteLand,
  type TaskWriteToken,
} from "./write-provenance";
// The client-emission projection (FIX-1005). Exported so a transport adapting
// `onChange` itself can apply the same omission; see
// `collection/change-event.ts` for why it is a deny-list.
export { toEmittedTask } from "./collection/change-event";

// Item windowing (FIX-480 §3.1) — substrate utilities for `task.items()`
// and renderer-side per-task expansion.
export {
  extractTaskItems,
} from "./items";

// Collections
export type {
  TaskCollectionRef,
  ClaimOptions,
  TaskHandle,
  TaskTransitionOptions,
  FailOptions,
  TaskWriteOutcome,
  TaskWriteDeclineReason,
  TaskWaitSlot,
  TaskProgress,
  TaskKeptOpenBy,
  TaskCancelSource,
  CancelOptions,
} from "./collection/types";
// Claimability and the lease (FIX-1005). `isClaimable` is THE admission
// predicate — the claim path, the board's wake probe and the ready-task
// preview all read this one function, and a caller implementing
// `TaskCollectionRef` itself should read it too rather than write a fourth
// copy. The constants are exported so a caller can size a lease against the
// bounds the substrate enforces.
export {
  isClaimable,
  claimDisposition,
  committedLeaseSpan,
  leaseLapsed,
  DEFAULT_MAX_ABANDONMENTS,
} from "./collection/internal";
// Collection caps — the two creation bounds (FIX-931) and the cumulative retry
// budget (FIX-948).
export {
  TaskCapExceededError,
  type TaskCapKind,
  type TaskCapOptions,
} from "./collection/task-caps";
export {
  getOrCreateTaskCollection,
  type GetOrCreateTaskCollectionOptions,
  type StateBackingSpec,
  type ResourceBackingSpec,
} from "./collection/get-or-create";

// Durable (resource-backed) task collections — the one-liner for a board
// whose tasks survive across turns.
export {
  defineTaskCollection,
  type DefinedTaskCollection,
  type DefineTaskCollectionOptions,
  type DeclaredFiledCascade,
} from "./collection/define-task-collection";
// A ledger kept per partition (`defineTaskCollection({ partitionBy })`).
export type { TaskPartitionContext, TaskPartitionFn } from "./collection/partition";
// A ledger's ending recorder (`defineTaskCollection({ recordEnding })`): what
// each ending write hands it, inside that same write.
export type { TaskEnding, TaskEndingRecorder } from "./collection/ending";
export { resolveResourceCollection } from "./collection/resolve-resource-collection";
// The child-finished signal (FIX-1794 S6 and S7, lifted by FIX-1816): the
// notice a task's ending owes the conversation that filed it, kept on the row
// by a ledger's ending recorder, and what that notice does there.
export {
  recordEnding,
  noticeText,
  noticeMetadata,
  parseNotice,
  type NoticeLine,
  type NoticeEnding,
  type TaskNotice,
  type NoticeRecording,
} from "./notice/task-notice";
// The one delivery of a delegated row's ending (FIX-2078).
export {
  type DeclaredDelivery,
  type NoticeAddress,
} from "./notice/delivery";

// Filed work still holding a task (FIX-2077, rule 6).
export { filedWorkKeepsOpen } from "./helpers/filed-work";

// Wake filters (FIX-660) — pair with `.waitForCondition`'s `wakeOn` option.
export { onTaskChangeFor } from "./collection/predicates";

// Claim orders
export type { ClaimOrder } from "./claim-orders/types";
export { fifoClaimOrder } from "./claim-orders/fifo";
export { priorityClaimOrder } from "./claim-orders/priority";

// Workers
export type {
  TaskWorker,
  TaskWorkerInput,
} from "./workers/types";

// Lease renewal (FIX-1005) — the worker half of durable-job recovery. Exported
// so a caller driving `claim` itself renews the lease it holds; a claimed row
// nobody renews is one the next drain takes back.
//
// The DRIVER only. The per-worker `AsyncLocalStorage` seam
// (`openLeaseRenewalScope` / `withLeaseRenewalScope` / `stampLeaseRenewal` /
// `currentLeaseRenewal`) is on `./internal` instead, which is Node-only:
// it needs `node:async_hooks`, and this subpath is published browser-safe
// (`docs/architecture/items.md`). See `test/tasks-subpath-browser-safe.spec.ts`.
export {
  startLeaseRenewal,
  withLeaseRenewal,
  type LeaseRenewalDriver,
  type LeaseRenewalOptions,
  type RenewalTimer,
} from "./lease-renewal";

// Flow policy — observation ledger + per-task selection policies that
// shape `TaskWorkerInput.priorWork` for Task Board worker dispatches.
export {
  flowPolicy,
  formatPriorWork,
} from "./flow-policy";
export type {
  Observation,
  ObservationLedgerView,
  TaskFlowPolicy,
  TaskPriorWork,
} from "./flow-policy";
