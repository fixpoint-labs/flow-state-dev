/**
 * Coordinator schema re-exports — kept for backward compatibility.
 *
 * These names are re-exported from `parallelTasks/schemas` where they
 * now live. Import from `@flow-state-dev/patterns` directly for new code.
 */
export {
  parallelTasksInputSchema as coordinatorInputSchema,
  type ParallelTasksInput as CoordinatorInput,
  type SubTaskErrorStrategy,
} from "../parallelTasks/schemas";
