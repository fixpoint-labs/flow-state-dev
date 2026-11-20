/**
 * Why a read or a write did not go through, in the words a screen shows, and
 * a section's outcome: its value, or that failure. One rule with `react`'s
 * hooks (`failureOf`), so a Retry note reads the same whether a hook's read
 * failed or a write the screen sent was refused.
 */
import { failureOf, type ViewReadFailure } from "@flow-state-dev/react/internal";

/** Why a read did not load: the server's reason, and its HTTP status when it answered one. */
export type Failure = ViewReadFailure;

/** One section's outcome: its value, or why it has none. */
export type Section<T> = { ok: true; value: T } | { ok: false; failure: Failure };

/** A failure, in the server's own words when it sent any. */
export function describeFailure(error: unknown): Failure {
  return failureOf(error);
}
