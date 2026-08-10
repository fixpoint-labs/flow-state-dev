/**
 * `@flow-state-dev/orchestration` — substrate package for task-shaped work
 * primitives (FIX-443 / FIX-444).
 *
 * Exports the Task schema, the uniform `TaskCollectionRef` API across
 * both backings (sequencer-state, resource-collection), the standard
 * dispatcher catalog, the worker contract, and the canonical helpers
 * for composing task loops inside sequencer patterns.
 *
 * Layering: `core` → `tasks` → `patterns`. Patterns consume this
 * package; this package never imports from `patterns`.
 */

// Schema
export {
  taskSchema,
  type Task,
  type TaskClaimIdentity,
  type TaskStatus,
} from "./schema/task";
export {
  taskStatusSchema,
  isTerminalStatus,
  isTransitionAllowed,
  allowedTransitionsFrom,
  assertTransitionAllowed,
  IllegalTaskTransitionError,
} from "./schema/task-status";
export {
  matchesFilter,
  type TaskInit,
  type TaskFilter,
} from "./schema/task-init";

// The ownership token a task write presents (FIX-981). `ticketNamesTask` is the
// guard's own identity rule and stays module-internal — a caller mints a ticket
// and presents it; deciding whether one matches is the collection's job.
export {
  taskClaimTicketSchema,
  ticketForClaim,
  type TaskClaimTicket,
} from "./claim-ticket";

// Change events (emitted as `task-change` component items via getOrCreateTaskCollection)
export type { TaskChangeEvent, TaskChangeKind } from "./collection/change-event";
// The client-emission projection and the set it honours (FIX-1005). Exported so
// a transport adapting `onChange` itself can apply the same omission; see
// `collection/change-event.ts` for why it is a deny-list.
export { toEmittedTask, SERVER_ONLY_TASK_FIELDS } from "./collection/change-event";

// Item windowing (FIX-480 §3.1) — substrate utilities for `task.items()`
// and renderer-side per-task expansion.
export {
  extractTaskItems,
  extractTaskItemWindows,
} from "./items";

// Collections
export type {
  TaskCollectionRef,
  ClaimOptions,
  TaskHandle,
  TaskTransitionOptions,
  TaskWriteOutcome,
  TaskWriteDeclineReason,
} from "./collection/types";
export { createSequencerBackedTaskCollection } from "./collection/sequencer-backed";
export type { SequencerBackedOptions } from "./collection/sequencer-backed";
export { createResourceBackedTaskCollection } from "./collection/resource-backed";
export type { ResourceBackedOptions } from "./collection/resource-backed";
// Claimability and the lease (FIX-1005). `isClaimable` is THE admission
// predicate — the claim path, the board's wake probe and the ready-task
// preview all read this one function, and a caller implementing
// `TaskCollectionRef` itself should read it too rather than write a fourth
// copy. The constants are exported so a caller can size a lease against the
// bounds the substrate enforces.
export {
  isClaimable,
  claimDisposition,
  isReady,
  leaseLapsed,
  readAbandonments,
  DEFAULT_LEASE_DURATION_MS,
  MIN_LEASE_DURATION_MS,
  MAX_LEASE_DURATION_MS,
  DEFAULT_MAX_ABANDONMENTS,
} from "./collection/internal";
// Collection caps — the two creation bounds (FIX-931) and the cumulative retry
// budget (FIX-948).
export {
  TaskCapExceededError,
  validateTaskCaps,
  resolveTaskCapDefaults,
  RETRY_BUDGET_NOT_APPLICABLE,
  DEFAULT_MAX_TOTAL_TASKS,
  DEFAULT_MAX_ENQUEUED_TASKS,
  DEFAULT_MAX_TOTAL_RETRIES,
  type TaskCapKind,
  type TaskCapOptions,
} from "./collection/task-caps";
export {
  getOrCreateTaskCollection,
  TASK_CHANGE_COMPONENT_TYPE,
  type GetOrCreateTaskCollectionOptions,
  type SequencerBackingSpec,
  type RequestBackingSpec,
  type ResourceBackingSpec,
} from "./collection/get-or-create";

// Durable (resource-backed) task collections — the one-liner for a board
// whose tasks survive across turns.
export {
  defineTaskCollection,
  isDefinedTaskCollection,
  type DefinedTaskCollection,
  type DefineTaskCollectionOptions,
} from "./collection/define-task-collection";
export { resolveResourceCollection } from "./collection/resolve-resource-collection";

// Wake filters (FIX-660) — pair with `.waitForCondition`'s `wakeOn` option.
export { onTaskChangeFor } from "./collection/predicates";

// Dispatchers
export type { TaskDispatcher } from "./dispatchers/types";
export { fifoDispatcher } from "./dispatchers/fifo";
export { topologicalDispatcher } from "./dispatchers/topological";
export { priorityDispatcher } from "./dispatchers/priority";
export {
  classifierDispatcher,
  type ClassifyFn,
  type ClassifierDispatcherOptions,
} from "./dispatchers/classifier";
export {
  eventDispatcher,
  type EventDispatcherOptions,
} from "./dispatchers/event";

// Workers
export type {
  TaskWorker,
  TaskWorkerInput,
  TaskWorkerRegistry,
} from "./workers/types";

// Helpers
export {
  taskLoopBack,
  defaultTaskLoopUntil,
  DEFAULT_TASK_LOOP_MAX_ITERATIONS,
  type TaskLoopBackOptions,
  type TaskLoopBackHandle,
} from "./helpers/task-loop-back";
export {
  dispatchAndExecuteBlock,
  type DispatchAndExecuteOptions,
  type DispatchAndExecuteResult,
} from "./helpers/dispatch-and-execute";

// Lease renewal (FIX-1005) — the worker half of durable-job recovery. Exported
// so a caller driving `claim` itself renews the lease it holds; a claimed row
// nobody renews is one the next drain takes back.
export {
  startLeaseRenewal,
  withLeaseRenewal,
  openLeaseRenewalScope,
  withLeaseRenewalScope,
  stampLeaseRenewal,
  currentLeaseRenewal,
  RENEWAL_DIVISOR,
  MIN_RENEWAL_DELAY_MS,
  type LeaseRenewalDriver,
  type LeaseRenewalOptions,
  type RenewalTimer,
} from "./lease-renewal";

// Flow policy — observation ledger + per-task selection policies that
// shape `TaskWorkerInput.priorWork` for Task Board worker dispatches.
export {
  bindObservationLedger,
  createObservationLedger,
  createObservationLedgerCapability,
  flowPolicy,
  formatPriorWork,
} from "./flow-policy";
export type {
  CreateObservationLedgerCapabilityOptions,
  Observation,
  ObservationLedger,
  ObservationLedgerAccessor,
  ObservationLedgerView,
  TaskFlowPolicy,
  TaskPriorWork,
} from "./flow-policy";
