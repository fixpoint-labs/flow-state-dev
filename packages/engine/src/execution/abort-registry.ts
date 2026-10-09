/**
 * In-process registry of AbortControllers for active requests.
 *
 * Each runAction call (each run attempt of a request) registers its own
 * controller here, and deregisters that controller when the attempt reaches
 * any terminal state.
 *
 * This map is per-process, and deliberately so: it is the single point a run
 * is torn down at, not the channel a cancellation travels on. Both delivery
 * paths converge here — the abort endpoint when the request is running in this
 * process, and `runAction`'s heartbeat poll when the intent was recorded
 * somewhere else — so a cross-process abort is indistinguishable downstream
 * from a local one.
 *
 * One request id can have several live run attempts at once (the stale-request
 * sweep marks a slow but live run `interrupted`, and `/continue` starts another
 * under the same id). So the registry holds one controller per live attempt: an
 * abort reaches every one of them, and an attempt that ends removes only its
 * own, never another attempt's.
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

/** Controllers of the live attempts of each request id, in registration order. */
const controllers = new Map<string, Registered[]>();

function entryOf(requestId: string, controller: AbortController): Registered | undefined {
  return controllers.get(requestId)?.find((entry) => entry.controller === controller);
}

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
 * Register an AbortController for a run attempt of a request. Returns the
 * controller so the caller can use its signal.
 *
 * Other attempts' controllers under the same id stay registered beside it.
 * Registering a controller that is already registered under the id only
 * updates its incarnation.
 *
 * Pass the request's incarnation when it is known, so a fenced
 * `abortRequest` can tell this request from a later one under the same id.
 * An untagged controller is never fired by a fenced abort; tag it later with
 * `tagAbortController` once the incarnation is known.
 *
 * Pass `controller` to register one a caller already holds, such as one handed
 * over from an earlier stage of the same dispatch. How it was fired so far
 * stays with it.
 */
export function registerAbortController(
  requestId: string,
  incarnation?: string,
  controller: AbortController = new AbortController()
): AbortController {
  const existing = entryOf(requestId, controller);
  if (existing !== undefined) {
    if (incarnation === undefined) delete existing.incarnation;
    else existing.incarnation = incarnation;
    return controller;
  }
  const entry: Registered = incarnation === undefined ? { controller } : { controller, incarnation };
  const entries = controllers.get(requestId);
  if (entries === undefined) controllers.set(requestId, [entry]);
  else entries.push(entry);
  return controller;
}

/**
 * Record the incarnation of an already-registered controller. Has no effect
 * when `controller` is no longer registered under `requestId`, so a late tag
 * cannot label a controller that has left the registry.
 */
export function tagAbortController(
  requestId: string,
  controller: AbortController,
  incarnation: string
): void {
  const entry = entryOf(requestId, controller);
  if (entry !== undefined) entry.incarnation = incarnation;
}

/**
 * Signal abort for a request: every live attempt's controller under the id.
 * Returns true if at least one was found and aborted, false if none was.
 *
 * With `expectedIncarnation`, fires only the controllers that belong to that
 * incarnation; a controller of another request under the same id, or one not
 * yet tagged, is left alone.
 */
export function abortRequest(requestId: string, expectedIncarnation?: string): boolean {
  const targets = (controllers.get(requestId) ?? []).filter((entry) =>
    matches(entry, expectedIncarnation)
  );
  for (const entry of targets) {
    const fired = firedBy.get(entry.controller) ?? {};
    if (expectedIncarnation === undefined) fired.unfenced = true;
    else fired.fenced = true;
    firedBy.set(entry.controller, fired);
    entry.controller.abort();
  }
  return targets.length > 0;
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
 * The fresh one takes `previous`'s place only if `previous` is still
 * registered; one that has already left the registry is not brought back.
 */
export function replaceAbortController(
  requestId: string,
  previous: AbortController,
  incarnation: string
): AbortController {
  const entry = entryOf(requestId, previous);
  const fresh = new AbortController();
  if (entry !== undefined) {
    entry.controller = fresh;
    entry.incarnation = incarnation;
  }
  return fresh;
}

/**
 * Remove a controller from the registry. Called by a run attempt on any
 * terminal state, with its own `controller`, so the controllers of other
 * attempts still live under the id stay registered.
 *
 * @remarks Called with `requestId` alone, it bulk-clears every live attempt's
 * controller under the id. Use that form only in tests and for a bulk clear;
 * a run attempt always passes its own `controller`.
 */
export function deregisterAbortController(requestId: string, controller?: AbortController): void {
  if (controller === undefined) {
    controllers.delete(requestId);
    return;
  }
  const entries = controllers.get(requestId);
  if (entries === undefined) return;
  const remaining = entries.filter((entry) => entry.controller !== controller);
  if (remaining.length === 0) controllers.delete(requestId);
  else controllers.set(requestId, remaining);
}

/**
 * Check whether a request has an active abort controller. With
 * `expectedIncarnation`, only a controller of that incarnation counts.
 */
export function hasActiveAbortController(requestId: string, expectedIncarnation?: string): boolean {
  return (controllers.get(requestId) ?? []).some((entry) => matches(entry, expectedIncarnation));
}
