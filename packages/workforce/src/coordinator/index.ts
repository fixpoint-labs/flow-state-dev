/**
 * The coordinator: a worker flow that hands each post to delegates from its
 * user's own roster, by its routing policy.
 *
 * - `defineCoordinatorFlow`: the `coordinator` worker flow, registered on a
 *   worker installation like any worker flow.
 * - `delegatedPostEntry`: the internal entry a worker flow declares so its
 *   workers can be delegates that take posts; `delegatedPostOnFinished`, the
 *   request `onFinished` that reports a cancelled run; and
 *   `delegatedPostHistory`, a generator `history` that hands a turn's model
 *   the conversation's recent lines a post came with, as a user-role message.
 *   The built-in `agent` flow has all three.
 * - The pinned names: the flow's kind, its `coordinator-route` record and
 *   its configuration keys. Its delegates, and their four actions, are any
 *   worker's (`../delegates`).
 */
export { defineCoordinatorFlow, type CoordinatorFlowOptions } from "./coordinator-flow";
export {
  COORDINATOR_ROUTING,
  coordinatorConfigSchema,
  type CoordinatorConfig,
  type CoordinatorRouting
} from "./coordinator-config";
export {
  COORDINATOR_JUDGMENT,
  COORDINATOR_KIND,
  COORDINATOR_ROUTE,
  MAX_ROUNDS
} from "./coordinator-keys";
export {
  coordinatorRouteRecordSchema,
  type BestFitWhy,
  type CoordinatorRouteRecord,
  type RoutedDelegate
} from "./coordinator-route";
export {
  delegatedAnswerSchema,
  delegatedPostEntry,
  delegatedPostHistory,
  delegatedPostOnFinished,
  delegatedPostSchema,
  type DelegatedAnswer,
  type DelegatedPost
} from "./delegated-post";
