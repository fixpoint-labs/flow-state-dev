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
  type TaskStatus,
} from "./schema/task";
export {
  taskStatusSchema,
  isTerminalStatus,
  isTransitionAllowed,
  allowedTransitionsFrom,
  assertTransitionAllowed,
} from "./schema/task-status";
export {
  matchesFilter,
  type TaskInit,
  type TaskFilter,
} from "./schema/task-init";

// Change events (emitted as `task-change` component items via getOrCreateTaskCollection)
export type { TaskChangeEvent, TaskChangeKind } from "./collection/change-event";

// Item windowing (FIX-480 §3.1) — substrate utilities for `task.items()`
// and renderer-side per-task expansion.
export {
  extractTaskItems,
  extractTaskItemWindows,
} from "./items";

// Collections
export type { TaskCollectionRef, ClaimOptions, TaskHandle } from "./collection/types";
export { createSequencerBackedTaskCollection } from "./collection/sequencer-backed";
export type { SequencerBackedOptions } from "./collection/sequencer-backed";
export { createResourceBackedTaskCollection } from "./collection/resource-backed";
export type { ResourceBackedOptions } from "./collection/resource-backed";
export {
  getOrCreateTaskCollection,
  TASK_CHANGE_COMPONENT_TYPE,
  type GetOrCreateTaskCollectionOptions,
  type SequencerBackingSpec,
  type RequestBackingSpec,
  type ResourceBackingSpec,
} from "./collection/get-or-create";

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
