/**
 * Public barrel for the reusable graph-edge primitive.
 *
 * Re-exports the typed-edge data model (`./edge`) and the pure traversal
 * functions (`./traverse`). This is the surface behind the
 * `@flow-state-dev/core/graph` subpath export — a standalone, dependency-free
 * graph layer with no coupling to the memory package or runtime.
 */

export {
  edgeListSchema,
  edgeSchema,
  nodeRef,
  parseNodeRef,
  type Edge,
  type NodeRef,
} from "./edge";

export {
  activeAt,
  egoGraph,
  MAX_DEPTH,
  neighbors,
  shortestPath,
  traverse,
  type TraversalOpts,
} from "./traverse";

export {
  createResourceEdgeApi,
  type AddEdgeInput,
  type EdgeBackingRef,
  type EdgeSlotConfig,
  type ResourceEdgeApi,
} from "./resource-edges";
