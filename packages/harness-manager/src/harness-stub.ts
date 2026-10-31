/**
 * A scripted harness for the slot: no model, no network, no vendor SDK.
 *
 * It records the two things a check grades — the prompt it was handed and the
 * directory it was told to work in — optionally does some real work in that
 * directory, and returns a handle that parses against core's neutral contract.
 * A host's model-free checks put it where a coding agent would go, so a
 * change that hard-codes a harness inside a coding flow breaks the check, not
 * just a test.
 *
 * Its slot takes the manager's {@link HarnessFeeds}, plus an optional
 * `mcpTools` feed a host relays MCP servers through. The stub takes no relayed
 * tools: handed one, it says in the run's session which servers it runs
 * without.
 */

import { handler, harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import type { CapabilityRef } from "@flow-state-dev/core";
import type {
  HarnessBlock,
  HarnessCallbackContext,
  HarnessRunOutcome,
  HarnessRunStatus,
} from "@flow-state-dev/core/types";
import type { HarnessFeeds } from "./manager";

/** One run the stub was asked to perform, exactly as it arrived. */
export interface StubRun {
  /** The prompt the manager built. */
  prompt: string;
  /** The directory the `cwd` feed resolved for this attempt. */
  cwd: string;
  /** The session id the `resume` feed offered, or null on a cold attempt. */
  resume: string | null;
}

export interface HarnessStubOptions {
  /**
   * What the run "did" in its checkout, if anything.
   *
   * A check's point is often that the directory is real: the honest way to
   * show a run was given its own checkout is to have it write there and then
   * read the result out of git. Absent means a run that produced nothing —
   * which is what a check's red half needs.
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
   * recorded rather than decisive.
   */
  outcome?: HarnessRunOutcome | null;
  /**
   * Anything the run wants to say: its final message, the answer an answer
   * task's output carries. Recorded on the row, and becomes retry feedback.
   * A function reads it off the run after `duringRun`, so a run can answer
   * with what it found in its working folder.
   */
  finalMessage?: string | null | ((run: StubRun) => string | null);
  /** The handle's `status` per run, overriding {@link status}. */
  statusOf?: (run: StubRun) => HarnessRunStatus;
  /** The handle's `outcome` word per run, overriding {@link outcome}. */
  outcomeOf?: (run: StubRun) => HarnessRunOutcome | null;
  /**
   * Lines the run says as it works, each emitted as a message in the run's own
   * session before `duringRun`. Absent means a run that says nothing, which is
   * what a model-free check grades. A host someone watches passes them, so the
   * task's Session has steps to show.
   */
  steps?: readonly string[];
  /**
   * How long the run pauses before each of its `steps`, so a user watching
   * the run's session sees them arrive. Abortable: an interrupt ends the wait.
   * Default 0.
   */
  stepEveryMs?: number;
  /**
   * The capabilities `mcpTools.named` reads through, held only when the slot
   * is handed `mcpTools`: workforce's `projectWorkspaceCapability`, for its
   * `projectMcpTools`.
   */
  mcpUses?: readonly CapabilityRef[];
}

/** The part of a host's MCP relay the stub asks: which servers a run's project names. */
export interface HarnessStubMcpTools {
  named(ctx: HarnessCallbackContext): Promise<readonly string[]>;
}

/** Wait `ms`, or reject as soon as `signal` aborts. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    // Removed when the timer wins, so a paced run leaves no listener per step.
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** The slot, plus the log of what each run was handed. */
export interface HarnessStub {
  /** Every run, in order. Empty means the harness was never reached. */
  runs: StubRun[];
  /** The factory to hand `harnessManager({ harness })`. */
  slot: (feeds: HarnessFeeds & { mcpTools?: HarnessStubMcpTools }) => HarnessBlock;
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
    slot: ({ cwd, resume, onSession, mcpTools }) =>
      handler({
        name: "harness-stub",
        inputSchema: harnessRunInputSchema,
        outputSchema: harnessRunHandleSchema,
        // What `named` reads through, only when the host relays MCP servers.
        ...(mcpTools === undefined || options.mcpUses === undefined ? {} : { uses: [...options.mcpUses] }),
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

          // The scripted run takes no relayed tools: a project that names MCP
          // servers runs without them here, and its session says so.
          const unrelayed = mcpTools === undefined ? [] : await mcpTools.named(context);
          if (unrelayed.length > 0) {
            ctx.emit.status(
              `This run goes without MCP servers ${unrelayed.join(", ")}: the scripted coder takes no relayed tools.`,
              { transient: false },
            );
          }

          for (const step of options.steps ?? []) {
            if ((options.stepEveryMs ?? 0) > 0) await pause(options.stepEveryMs!, ctx.signal);
            ctx.emit.message(step);
          }
          await options.duringRun?.(run);

          return {
            source: "harness-manager/stub",
            status: options.statusOf?.(run) ?? options.status ?? ("completed" as const),
            sessionId: `sess_stub_${sessions}`,
            url: null,
            dispatchedAt: Date.now(),
            outcome:
              options.outcomeOf !== undefined
                ? options.outcomeOf(run)
                : options.outcome === undefined
                  ? ("finished" as const)
                  : options.outcome,
            finalMessage:
              typeof options.finalMessage === "function" ? options.finalMessage(run) : (options.finalMessage ?? null),
            usage: null,
            cost: null,
          };
        },
      }) as unknown as HarnessBlock,
  };
}
