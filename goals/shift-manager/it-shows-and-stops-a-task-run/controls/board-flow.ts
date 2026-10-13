/**
 * Control `board-flow`: every run is opened through the board's flow, the
 * lead's, instead of the flow its session records as its owner.
 *
 * Built into the control page in place of `src/lib/run.ts`. The goal injects
 * the lead's flow id, read off the tree, as `__BOARD_FLOW__`. No run is on the
 * lead's flow, so none opens: the goal must fail at "items equal the run
 * session's" on every run row.
 */
declare const __BOARD_FLOW__: string;

export * from "../../../../packages/shift-manager/src/lib/run.ts";

export async function resolveRunFlow(): Promise<string> {
  return __BOARD_FLOW__;
}
