/**
 * `@flow-state-dev/tasks` — substrate package for task-shaped work
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

// Items
export {
  buildTaskChangeItem,
  type TaskChangeItem,
  type TaskChangeKind,
  type TaskChangeEmissionFrame,
} from "./items/task-change";

// Collections
export type { TaskCollectionRef, ClaimOptions } from "./collection/types";
export { createSequencerBackedTaskCollection } from "./collection/sequencer-backed";
export type { SequencerBackedOptions } from "./collection/sequencer-backed";
export { createResourceBackedTaskCollection } from "./collection/resource-backed";
export type { ResourceBackedOptions } from "./collection/resource-backed";
export {
  getOrCreateTaskCollection,
  type GetOrCreateTaskCollectionOptions,
  type SequencerBackingSpec,
  type ResourceBackingSpec,
} from "./collection/get-or-create";

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
  dispatchAndExecute,
  type DispatchAndExecuteOptions,
  type DispatchAndExecuteResult,
} from "./helpers/dispatch-and-execute";
