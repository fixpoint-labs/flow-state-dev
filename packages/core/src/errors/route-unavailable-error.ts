/**
 * Router resume-stability error (FIX-814). Thrown when a router re-entered
 * during same-request continuation re-runs its `execute` selector and the
 * selection no longer matches the durably recorded `router_decision` — either
 * because the selector re-decided differently (non-deterministic selection) or
 * because the recorded route no longer exists in the route table. The branch
 * decision must stay stable across a suspension; a mismatch is fatal, never a
 * silent branch switch.
 */
import { FlowError } from "./flow-error";

/** Structured details carried by {@link RouteUnavailableError}. */
export type RouteUnavailableDetails = {
  routerName: string;
  /** The route name persisted in the request's `router_decision` item. */
  recordedRoute: string;
  /** The route the re-run selector picked on resume (when it picked one). */
  reselectedRoute?: string;
  /** Whether the recorded route still appears in the router's route table. */
  recordedRouteDeclared: boolean;
};

/**
 * Fatal, non-retryable resume error: the recorded router decision cannot be
 * honored on continuation. See {@link RouteUnavailableDetails} for which of
 * the two causes (re-decision drift vs. removed route) applies.
 */
export class RouteUnavailableError extends FlowError {
  // Narrow the base's `details` type; the value is assigned by the FlowError
  // constructor (`declare` avoids a field re-declaration clobbering it).
  declare readonly details: RouteUnavailableDetails;

  constructor(details: RouteUnavailableDetails) {
    const cause = details.recordedRouteDeclared
      ? `its \`execute\` re-selected "${details.reselectedRoute}" on resume — the selector must be deterministic (pure over input) for a router whose branch can suspend`
      : `route "${details.recordedRoute}" is no longer declared in the route table`;
    super(
      `Router "${details.routerName}" cannot resume: the recorded decision selected route "${details.recordedRoute}" but ${cause}.`,
      {
        code: "ROUTE_UNAVAILABLE",
        retryable: false,
        blockName: details.routerName,
        scope: "block",
        details
      }
    );
    this.name = "RouteUnavailableError";
  }
}
