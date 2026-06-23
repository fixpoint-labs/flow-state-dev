/**
 * Internal-only items API. Not part of the public surface — accessible via
 * `@flow-state-dev/contracts/items/internal` (re-exported from
 * `@flow-state-dev/core/items/internal`). Carries the `ref` BlockValue case
 * and the runtime item union (public `OutputItem` plus the four trace types)
 * used by the executor, persistence layer, and observability surfaces.
 */
import type {
  BlockTraceItem,
  OutputItem,
  RouterDecisionItem,
  StateSnapshotItem
} from "./types";

export type { BlockValueInternal } from "./types";
export { refBlockValue, resolveBlockValueInternal } from "./resolve-value";
// Re-exported here so browser bundles (e.g. the DevTool) can parse a
// blockInstanceId's structural path without importing the root barrel, which
// drags in non-browser-safe modules. `block-instance-id` is a pure,
// dependency-free string helper.
export { parseBlockInstanceId } from "../block-instance-id";

/**
 * Runtime item union. Public `OutputItem` is the 10 client-visible types;
 * runtime buffers, the trace channel, and devtool consumers carry the three
 * additional trace types (`block_trace`, `router_decision`, `state_snapshot`).
 * Use this alias when narrowing items that may be either kind.
 */
export type RuntimeItem =
  | OutputItem
  | BlockTraceItem
  | RouterDecisionItem
  | StateSnapshotItem;

