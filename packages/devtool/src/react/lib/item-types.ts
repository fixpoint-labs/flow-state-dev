/**
 * DevTool item-type widening. The public `OutputItem` exposes only the 10
 * client-visible types. The DevTool consumes the full stream — including
 * internal trace items (`block_output`, `router_decision`, `state_snapshot`,
 * `block_debug`) routed via the trace channel. This alias re-exports a wider
 * union so devtool component switches narrow correctly.
 */
import type {
  OutputItem,
  BlockOutputItem,
  RouterDecisionItem,
  StateSnapshotItem,
  BlockDebugItem
} from "@flow-state-dev/core/items";

export type DevtoolItem =
  | OutputItem
  | BlockOutputItem
  | RouterDecisionItem
  | StateSnapshotItem
  | BlockDebugItem;
