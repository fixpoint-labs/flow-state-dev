/**
 * In-process registry of AbortControllers for active requests.
 *
 * Each runAction call registers a controller here. The controller is
 * deregistered when the request reaches any terminal state.
 *
 * This map is per-process, and deliberately so: it is the single point a run
 * is torn down at, not the channel a cancellation travels on. Both delivery
 * paths converge here — the abort endpoint when the request is running in this
 * process, and `runAction`'s heartbeat poll when the intent was recorded
 * somewhere else — so a cross-process abort is indistinguishable downstream
 * from a local one.
 */

const controllers = new Map<string, AbortController>();

/**
 * Register an AbortController for a request. Returns the controller
 * so the caller can use its signal.
 */
export function registerAbortController(requestId: string): AbortController {
  const controller = new AbortController();
  controllers.set(requestId, controller);
  return controller;
}

/**
 * Signal abort for a request. Returns true if the request was found
 * and aborted, false if the request was not in the registry.
 */
export function abortRequest(requestId: string): boolean {
  const controller = controllers.get(requestId);
  if (controller === undefined) {
    return false;
  }
  controller.abort();
  return true;
}

/**
 * Remove the controller from the registry. Called on any terminal state.
 */
export function deregisterAbortController(requestId: string): void {
  controllers.delete(requestId);
}

/**
 * Check whether a request has an active abort controller.
 */
export function hasActiveAbortController(requestId: string): boolean {
  return controllers.has(requestId);
}
