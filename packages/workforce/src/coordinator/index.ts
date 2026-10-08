/**
 * The coordinator: a worker flow that hands each post to delegates from its
 * user's own roster, by its routing policy.
 *
 * - `defineCoordinatorFlow`: the `coordinator` worker flow, registered on a
 *   worker installation like any worker flow.
 * - `delegatedPostEntry`: the internal entry a worker flow declares so its
 *   workers can be delegates that take posts. The built-in `agent` flow
 *   declares it.
 * - The pinned names: the flow's kind, its `coordinator-route` record, its
 *   four delegate actions and its configuration keys.
 */
export { defineCoordinatorFlow, type CoordinatorFlowOptions } from "./coordinator-flow";
export {
  COORDINATOR_ROUTING,
  coordinatorConfigSchema,
  type CoordinatorConfig,
  type CoordinatorRouting
} from "./coordinator-config";
export {
  ADD_DELEGATE,
  COORDINATOR_JUDGMENT,
  COORDINATOR_KIND,
  COORDINATOR_ROUTE,
  DELEGATED_POST_ENTRY,
  LIST_DELEGATES,
  MAX_DELEGATES,
  MAX_ROUNDS,
  REMOVE_DELEGATE,
  SET_FALLBACK
} from "./coordinator-keys";
export { delegateRecordSchema, type DelegateRecord } from "./coordinator-delegates";
export {
  coordinatorRouteRecordSchema,
  type CoordinatorRouteRecord,
  type RoutedDelegate
} from "./coordinator-route";
export {
  delegatedAnswerSchema,
  delegatedPostEntry,
  delegatedPostSchema,
  type DelegatedAnswer,
  type DelegatedPost
} from "./delegated-post";
