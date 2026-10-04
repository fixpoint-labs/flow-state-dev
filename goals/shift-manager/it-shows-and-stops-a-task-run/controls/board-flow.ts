/**
 * Control `board-flow`: every run is opened through the board's flow, the
 * flow that drains it, instead of the flow its session records as its owner.
 *
 * Built into the control page in place of `src/lib/run.ts`. The goal injects
 * the drainer's flow id, read off the tree, as `__BOARD_FLOW__`. A run on the
 * drainer's own flow still opens; the run of a seat on a flow of its own does
 * not. The goal must fail at "items equal the run session's" on that seat's
 * row, and pass the others.
 */
declare const __BOARD_FLOW__: string;

export * from "../../../../labs/shift-manager/src/lib/run.ts";

export async function resolveRunFlow(): Promise<string> {
  return __BOARD_FLOW__;
}
