/**
 * The coordinator: a worker flow that hands each of its user's messages to
 * delegates from their own roster, by its routing policy, as tasks (FIX-2083).
 * A delegate is a worker whose flow takes a conversation's tasks
 * (`workerTaskEntry`); nothing else makes it one.
 *
 * - `defineCoordinatorFlow`: the `coordinator` worker flow, registered on a
 *   worker installation like any worker flow.
 * - The pinned names: the flow's name, its `coordinator-route` record and
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
  COORDINATOR_FLOW,
  COORDINATOR_ROUTE,
  MAX_ROUNDS
} from "./coordinator-keys";
export {
  coordinatorRouteRecordSchema,
  type BestFitWhy,
  type CoordinatorRouteRecord,
  type RoutedDelegate
} from "./coordinator-route";
