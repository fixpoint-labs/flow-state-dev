// FIX-2623.
/**
 * A context with no session: what a user or org view runs on. Nothing is
 * loaded, made or stored for a session; where `ctx.session` and the session
 * record would be, a stand-in refuses every use with {@link NoSessionError}.
 * A throwaway session would pass a test and prove nothing.
 */
import type { SessionRecord } from "../stores/types";

/** What reaching for a session throws in a view that runs with none. */
export class NoSessionError extends Error {
  constructor(what: string) {
    super(`This view runs with no session: it can't ${what}. A user or org view reads only user and org data.`);
    this.name = "NoSessionError";
  }
}

/** A stand-in that throws {@link NoSessionError} naming `what` on any property but a thenable probe. */
function refusing<T extends object>(what: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      // A symbol or `then` is a runtime probe (inspection, an `await`), not a use.
      if (typeof prop === "symbol" || prop === "then") return undefined;
      throw new NoSessionError(`${what} (${prop})`);
    }
  });
}

/** Stands where `ctx.session` would. */
export function noSessionHandle<T extends object>(): T {
  return refusing<T>("use ctx.session");
}

/** Stands where the session record would. */
export function noSessionRecord(): SessionRecord {
  return refusing<SessionRecord>("read the session record");
}
