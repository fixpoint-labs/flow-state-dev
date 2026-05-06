/**
 * Internal-only items API. Not part of the public surface — accessible via
 * `@flow-state-dev/core/items/internal`. Carries the `ref` BlockValue case
 * and the runtime item union (public `OutputItem` plus the four trace types)
 * used by the executor, persistence layer, and observability surfaces.
 */
import type {
  BlockDebugItem,
  BlockOutputItem,
  OutputItem,
  RouterDecisionItem,
  StateSnapshotItem
} from "./types";

export type { BlockValueInternal } from "./types";
export { refBlockValue, resolveBlockValueInternal } from "./resolve-value";

/**
 * Runtime item union. Public `OutputItem` is the 10 client-visible types;
 * runtime buffers, the trace channel, and devtool consumers carry the four
 * additional trace types (`block_output`, `router_decision`,
 * `state_snapshot`, `block_debug`). Use this alias when narrowing items
 * that may be either kind.
 */
export type RuntimeItem =
  | OutputItem
  | BlockOutputItem
  | RouterDecisionItem
  | StateSnapshotItem
  | BlockDebugItem;

