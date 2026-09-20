/**
 * The scripted run the contract gate puts in the harness slot.
 *
 * No model, no network, no vendor SDK. It records the two things the gate
 * grades — the prompt it was handed and the directory it was told to work in —
 * optionally does some real work in that directory, and returns a handle that
 * parses against the neutral contract.
 *
 * **Modelled on `fakeHarness` in `packages/harness-manager/test/slot.spec.ts`**,
 * which is the cheapest existing proof that the manager drives any conforming
 * harness. Deliberately not `claudeCodeAgent` and deliberately nothing out of
 * `labs/conductor`: those belong to the model-backed sibling check, and a stub
 * that reached for one would make the gate's model-freedom an accident.
 *
 * The slot is the whole of D2. Two checks drive the same tree, the same hire
 * and the same wiring and differ by this one expression — so a future change
 * that hard-codes a harness inside the `coder` kind breaks the gate, not just a
 * test.
 */

import { handler, harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import type {
  HarnessBlock,
  HarnessCallbackContext,
  HarnessRunOutcome,
  HarnessRunStatus,
} from "@flow-state-dev/core/types";

/** One run the stub was asked to perform, exactly as it arrived. */
export interface StubRun {
  /** The prompt the manager built — BR-10's evidence, and the only evidence for it. */
  prompt: string;
  /** The directory the `cwd` feed resolved for this attempt — BR-11's. */
  cwd: string;
  /** The session id the `resume` feed offered, or null on a cold attempt. */
  resume: string | null;
}

export interface HarnessStubOptions {
  /**
   * What the run "did" in its checkout, if anything.
   *
   * The gate's whole point is that the directory is real: the honest way to
   * show a run was given its own checkout is to have it write there and then
   * read the result out of git. Absent means a run that produced nothing —
   * which is the red half of BR-13/BR-14.
   */
  duringRun?: (run: StubRun) => void | Promise<void>;
  /**
   * The handle's `status`. `"completed"` is a verdict the manager reads as a
   * clean finish; `"errored"` is a failed attempt.
   */
  status?: HarnessRunStatus;
  /**
   * The handle's `outcome` word.
   *
   * Note what this does **not** do on its own: the manager reads `status` for
   * success and then asks the phase's done-condition, so the outcome word is
   * recorded rather than decisive. BR-12 is graded on that seam, not on this
   * field.
   */
  outcome?: HarnessRunOutcome | null;
  /** Anything the run wants to say. Recorded on the row, and becomes retry feedback. */
  finalMessage?: string | null;
}

/** The slot, plus the log the gate grades. */
export interface HarnessStub {
  /** Every run, in order. Empty means the harness was never reached. */
  runs: StubRun[];
  /** The factory to hand `harnessManager({ harness })`. */
  slot: (feeds: {
    cwd: (ctx: HarnessCallbackContext) => string | Promise<string>;
    resume: (ctx: HarnessCallbackContext) => string | null | Promise<string | null>;
    onSession: (sessionId: string, ctx: HarnessCallbackContext) => void | Promise<void>;
  }) => HarnessBlock;
}

/**
 * Build a scripted harness.
 *
 * @param options What the run does in its checkout and what it reports back.
 * @returns The slot to install, and the log of what it was handed.
 */
export function harnessStub(options: HarnessStubOptions = {}): HarnessStub {
  const runs: StubRun[] = [];
  let sessions = 0;

  return {
    runs,
    slot: ({ cwd, resume, onSession }) =>
      handler({
        name: "devforce-lab-harness-stub",
        inputSchema: harnessRunInputSchema,
        outputSchema: harnessRunHandleSchema,
        execute: async (input: { prompt: string }, ctx) => {
          const context = ctx as unknown as HarnessCallbackContext;
          const run: StubRun = {
            prompt: input.prompt,
            cwd: await cwd(context),
            resume: await resume(context),
          };
          runs.push(run);

          // A conforming harness names its session the moment it has one, so
          // the manager can resume it after a kill. The stub does the same
          // rather than skipping it: `onSession` is the write side of the
          // resume feed, and a stub that never called it would leave that half
          // of the contract unexercised in the one check that runs model-free.
          sessions += 1;
          await onSession(`sess_stub_${sessions}`, context);

          await options.duringRun?.(run);

          return {
            source: "devforce-lab/stub",
            status: options.status ?? ("completed" as const),
            sessionId: `sess_stub_${sessions}`,
            url: null,
            dispatchedAt: Date.now(),
            outcome: options.outcome === undefined ? ("finished" as const) : options.outcome,
            finalMessage: options.finalMessage ?? null,
            usage: null,
            cost: null,
          };
        },
      }) as unknown as HarnessBlock,
  };
}
