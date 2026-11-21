/**
 * Control `board-flow`: every run is opened through the board's flow, the
 * lead's, instead of the flow its session records as its owner.
 *
 * Built into the control page in place of `src/lib/task-items.ts`. The goal
 * injects the lead's flow id, read off the tree, as `__BOARD_FLOW__`. No run
 * is on the lead's flow, so the run's stream and its stop reach nothing: the
 * goal must fail at "the request reads aborted first" on every running row.
 */
declare const __BOARD_FLOW__: string;

export * from "../../../../packages/shift-manager/src/lib/task-items.ts";

export async function resolveRunFlow(): Promise<string> {
  return __BOARD_FLOW__;
}
