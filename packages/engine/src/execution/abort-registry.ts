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
 *
 * A request id names one request only while its record exists, so the id alone
 * cannot tell a checked request from a later one that reused it. A controller
 * therefore carries the incarnation of the request it belongs to, and a caller
 * that checked a record passes that record's incarnation to fire or probe only
 * that request's controller. Callers with no record to check (a CLI's own
 * cancel, a parent cascading to its child) pass none and act on the id alone.
 */

interface Registered {
  controller: AbortController;
  /** The incarnation of the request this controller belongs to, once known. */
  incarnation?: string;
}

const controllers = new Map<string, Registered>();

/**
 * How each controller was fired, kept on the controller rather than on its
 * registry slot, so the answer survives another run taking the slot.
 * `fenced`: a fire for the incarnation the controller was tagged with then.
 * `unfenced`: a fire for whatever runs under the id; recorded even when the
 * controller had already fired, so an earlier fenced fire never hides it.
 */
const firedBy = new WeakMap<AbortController, { fenced?: boolean; unfenced?: boolean }>();

/** True when `entry` may be acted on by a caller expecting `expected`. */
function matches(entry: Registered, expected: string | undefined): boolean {
  return expected === undefined || entry.incarnation === expected;
}

/**
 * Register an AbortController for a request. Returns the controller
 * so the caller can use its signal.
 *
 * Pass the request's incarnation when it is known, so a fenced
 * `abortRequest` can tell this request from a later one under the same id.
 * An untagged controller is never fired by a fenced abort; tag it later with
 * `tagAbortController` once the incarnation is known.
 */
export function registerAbortController(requestId: string, incarnation?: string): AbortController {
  const controller = new AbortController();
  controllers.set(requestId, incarnation === undefined ? { controller } : { controller, incarnation });
  return controller;
}

/**
 * Record the incarnation of an already-registered controller. Has no effect
 * when `controller` is no longer the one registered under `requestId`, so a
 * late tag cannot label a later request's controller.
 */
export function tagAbortController(
  requestId: string,
  controller: AbortController,
  incarnation: string
): void {
  const entry = controllers.get(requestId);
  if (entry !== undefined && entry.controller === controller) {
    entry.incarnation = incarnation;
  }
}

/**
 * Signal abort for a request. Returns true if the request was found
 * and aborted, false if the request was not in the registry.
 *
 * With `expectedIncarnation`, fires only when the registered controller
 * belongs to that incarnation; a controller of another request under the same
 * id, or one not yet tagged, is left alone and the call returns false.
 */
export function abortRequest(requestId: string, expectedIncarnation?: string): boolean {
  const entry = controllers.get(requestId);
  if (entry === undefined || !matches(entry, expectedIncarnation)) {
    return false;
  }
  const fired = firedBy.get(entry.controller) ?? {};
  if (expectedIncarnation === undefined) fired.unfenced = true;
  else fired.fenced = true;
  firedBy.set(entry.controller, fired);
  entry.controller.abort();
  return true;
}

/**
 * Whether `controller` was fired only by fenced `abortRequest`s: fires for one
 * incarnation of its request, and none for whatever runs under the id. False
 * when it has not fired or when any fire was unfenced. Answered whether or not
 * the controller is still registered.
 */
export function wasFiredOnlyFenced(controller: AbortController): boolean {
  const fired = firedBy.get(controller);
  return fired?.fenced === true && fired.unfenced !== true;
}

/**
 * Give up `previous` for a fresh, unfired controller tagged `incarnation`.
 * The fresh one takes the registry slot only if `previous` still holds it;
 * a controller another run displaced does not take the slot back.
 */
export function replaceAbortController(
  requestId: string,
  previous: AbortController,
  incarnation: string
): AbortController {
  if (controllers.get(requestId)?.controller === previous) {
    return registerAbortController(requestId, incarnation);
  }
  return new AbortController();
}

/**
 * Remove the controller from the registry. Called on any terminal state.
 */
export function deregisterAbortController(requestId: string): void {
  controllers.delete(requestId);
}

/**
 * Check whether a request has an active abort controller. With
 * `expectedIncarnation`, only a controller of that incarnation counts.
 */
export function hasActiveAbortController(requestId: string, expectedIncarnation?: string): boolean {
  const entry = controllers.get(requestId);
  return entry !== undefined && matches(entry, expectedIncarnation);
}
