/**
 * Test helper: `admit`, then `run` in the admission's turn — the two steps the
 * host takes around a dispatch's writes, collapsed for tests that have no
 * writes. A refusal over the in-memory backend still throws from the call
 * itself, as `admit` does; over a supplied backend it rejects the run.
 */
import {
  isPendingAdmission,
  type ConcurrencyArbiter,
  type ResolvedDecision
} from "../../../src/transports/concurrency/arbiter";

export function admitAndRun(
  arbiter: ConcurrencyArbiter,
  decision: ResolvedDecision,
  requestId: string
): <T>(start: () => Promise<T>) => Promise<T> {
  const admission = arbiter.admit(decision, requestId);
  if (!isPendingAdmission(admission)) return (start) => admission.run(start);
  return (start) => admission.then((admitted) => admitted.run(start));
}
