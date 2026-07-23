/**
 * `applyReplan` — re-exported from its lifted home in
 * `@flow-state-dev/orchestration/task-board` (FIX-910).
 *
 * The implementation moved down into orchestration so the `goalSeekLoop`
 * primitive (which sits below patterns in the `core → orchestration → patterns`
 * layering) can execute it directly. This module preserves plan-and-execute's
 * public subpath export (BP-034: finish the move, keep subpath re-exports).
 */
export {
  createApplyReplan,
  type ApplyReplanOptions,
} from "@flow-state-dev/orchestration/task-board";
