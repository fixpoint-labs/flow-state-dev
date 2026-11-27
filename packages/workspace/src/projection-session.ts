// FIX-2935.
/**
 * `projectionSession`: one projection opened over a place, then flushed back.
 *
 * The bash tools and the Claude Code workspace each open a projection,
 * hydrate it, and flush it at the end, and both make the same call about a
 * failed flush: a place that could not be read is reported and the run goes
 * on; any other failure is the run's work not reaching its collections, and
 * throws. That call is made here, once. What each caller says about the
 * outcomes (a console warning, a status line, a row in a log) stays its own.
 */
import { createProjection } from "./projection";
import type { Projection, ProjectionOptions } from "./projection";
import { PlaceUnreadableError, type FlushOutcome } from "./types";

/** What a flush settled to: what it decided, or that the place could not be read. */
export type SettledFlush =
  | { readable: true; outcomes: readonly FlushOutcome[] }
  | { readable: false; error: PlaceUnreadableError };

/** One projection's open-and-close. */
export interface ProjectionSession {
  /** The projection itself, for `put` and anything beyond hydrate and flush. */
  readonly projection: Projection;
  /** Lay every mount's entries into the place. */
  hydrate(): Promise<void>;
  /**
   * Reconcile the place back into its collections.
   *
   * Resolves `readable: false` when, and only when, the place could not be
   * listed: the projection decided nothing, so nothing was deleted, and the
   * run's files are still where it left them. Every other failure (a
   * collection read, write or delete) rejects, because a run reported as
   * finished while its files never reached the store is a silent loss.
   */
  flush(): Promise<SettledFlush>;
}

/**
 * Open a projection over `options.place` and `options.mounts`.
 *
 * @example
 *   const session = projectionSession({ place: createHostPlace(root), mounts });
 *   await session.hydrate();
 *   // ... the run works in `root` ...
 *   const settled = await session.flush();
 *   if (!settled.readable) report(settled.error.message);
 */
export function projectionSession(options: ProjectionOptions): ProjectionSession {
  const projection = createProjection(options);
  return {
    projection,
    hydrate: () => projection.hydrate(),
    flush: async () => {
      try {
        return { readable: true, outcomes: (await projection.flush()).outcomes };
      } catch (err) {
        if (!(err instanceof PlaceUnreadableError)) throw err;
        return { readable: false, error: err };
      }
    },
  };
}
