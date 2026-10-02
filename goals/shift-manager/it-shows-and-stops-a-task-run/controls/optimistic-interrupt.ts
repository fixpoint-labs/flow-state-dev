/**
 * Control `optimistic-interrupt`: Interrupt draws *interrupted* without
 * aborting anything.
 *
 * Built into the control page in place of `src/lib/run.ts`. `interruptRun`
 * never calls the abort route and answers as though the record read
 * `aborted`. The goal must fail at "the request reads aborted first".
 */
import type { InterruptOutcome } from "../../../../labs/shift-manager/src/lib/run.ts";

export * from "../../../../labs/shift-manager/src/lib/run.ts";

export async function interruptRun(): Promise<InterruptOutcome> {
  return { kind: "aborted" };
}
