/**
 * The projects' own retry around a compare-and-swap write that lost a race.
 *
 * The engine's resource CAS driver already retries a conflicting write three
 * times and then gives up with `concurrent_modification`. On a hot row that is
 * not enough. This helper keeps going past the engine's budget, with jittered
 * backoff, for the writes that contend by design: a project row's workstream
 * list (`setWorkstreams` in `project-writes.ts`) and a workstream's entry
 * (`workstream-writes.ts`).
 *
 * In a module of its own so a test can swap it for a single attempt and show
 * that, without it, a burst loses a write (the `no-retry` control).
 */

import { isConcurrentModification } from "./store-errors";

/** Attempts in all, each of which is itself the engine's three. */
const DEFAULT_ATTEMPTS = 25;
/** Base backoff; the wait before attempt n is up to `n * base` ms, jittered. */
const DEFAULT_BASE_DELAY_MS = 5;

/**
 * Run `write`, and run it again whenever it loses a compare-and-swap race.
 * Any other error is thrown at once. `write` must be safe to repeat; a CAS
 * updater that recomputes from the state it is handed is.
 *
 * @throws the last conflict once every attempt has lost.
 */
export async function retryOnConflict<T>(
  write: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const base = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await write();
    } catch (error) {
      if (attempt >= attempts || !isConcurrentModification(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * base * attempt));
    }
  }
}
