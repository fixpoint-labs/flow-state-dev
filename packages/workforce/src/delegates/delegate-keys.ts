/**
 * The names a worker's delegates pin: the four actions that change a
 * session's delegates, the most one session holds, and the server-written
 * session state they live in.
 *
 * A leaf with no imports, so the worker contract, the delegate module and
 * every flow that carries delegates share one spelling of each.
 */

/** The four delegate actions. **Pinned**: an app sends them by name. */
export const ADD_DELEGATE = "addDelegate";
export const REMOVE_DELEGATE = "removeDelegate";
export const SET_FALLBACK = "setFallback";
export const LIST_DELEGATES = "listDelegates";

/** The most delegate records one session holds, and the most a worker's `delegates:` lists. */
export const MAX_DELEGATES = 25;

/** Server-written session state: the session's delegate records, `null` until first read or changed. */
export const DELEGATES_STATE = "delegates";
/** Server-written session state: the session's fallback delegate record, or `null`. */
export const FALLBACK_STATE = "fallback";
