/**
 * Public route parsing/adapter surface for server catch-all integration.
 */
export {
  createFlowApiRouter,
  disposeFlowApiRouter,
  dispatchDedicatedRoute,
  type CreateFlowApiRouterOptions,
  type FlowApiRouter
} from "./createFlowApiRouter";
export {
  parseFlowRoute,
  type ParsedFlowRoute
} from "./parseFlowRoute";
/**
 * The wire contract of `GET /sessions/:sessionId/workstreams` (FIX-1010).
 * Exported because the client and React hops consume this shape; they must not
 * restate or re-derive the status rule, which this route owns.
 */
export {
  type WorkstreamStatus,
  type WorkstreamSummary
} from "./workstream-routes";
