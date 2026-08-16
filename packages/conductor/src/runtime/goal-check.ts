/**
 * Running the goal check — the one place a verdict comes from.
 *
 * ```
 * config.goalCheck ──▶ spawn(argv…, entityId) in the provisioned workspace ──▶ exit status
 *                                                                                  │
 *                                              "passed" / "failed" / no verdict ◀───┘
 * ```
 *
 * **A verdict is an exit status or it is nothing.** `DispatchResult.goalCheck`
 * has always said so, and until this file existed nothing could satisfy it: a
 * coding harness returns the terminal subtype of its own agent loop, not the
 * exit status of whatever the agent ran inside it, so there is no status for an
 * adapter to read and every shipped dispatcher correctly reported no verdict at
 * all. The consequence was one gate — `awaiting_goal_check` — that nothing could
 * ever release, and a merged issue waiting on it forever while looking healthy,
 * because a gate was named.
 *
 * So the verdict is conductor's own work rather than each vendor's. It is
 * vendor-neutral (the same command runs whichever harness did the coding), it
 * needs no model, and it cannot be talked into a pass: prose is not consulted,
 * a non-zero exit is a failure however confidently the run described itself.
 *
 * ---------------------------------------------------------------------------
 * THE TRUST BOUNDARY
 * ---------------------------------------------------------------------------
 *
 * This executes a program from the repository, so what selects it matters more
 * than what it does:
 *
 * - **The command is declared, in `conductor.config.ts`, by whoever configures
 *   conductor.** It is not discovered, matched, globbed or inferred from a
 *   filename. Nothing conductor reads at run time can add to it or replace it.
 * - **The brief cannot influence it.** The brief carries the command *outward*
 *   so an agent knows what its work will be measured by; nothing reads a brief
 *   back, and a {@link DispatchResult} has nowhere to name a command. An agent
 *   that writes "run this instead" into a final message has written prose.
 * - **The only thing conductor appends is the work item's id**, from its own
 *   registry. It is passed as one argv element with no shell anywhere in the
 *   path, so it is an argument and can never become a command.
 * - **What the command *does* is trusted, and unavoidably so.** It is a program
 *   in the repo, run against a checkout of the repo, and a post-merge check
 *   stands on the base branch — code a human reviewed and merged. Conductor
 *   inherits the repository's own trust boundary here and does not widen it;
 *   what it refuses to do is *choose* a program.
 */

import { ExecaError, execa } from "execa";

import type { ResolvedGoalCheck } from "../config/define";
import { renderCommand } from "../util/command";

/**
 * How much of a failing runner's output to keep for the reason.
 *
 * A tail rather than the whole stream: the reason travels into durable state and
 * an unbounded one would put a runner's entire log there. The tail is the end,
 * because that is where a stack trace and a "command not found" land.
 */
const REASON_TAIL = 2000;

/**
 * How much stderr conductor will hold while a runner produces it.
 *
 * Only the last {@link REASON_TAIL} characters are ever read, so this is not a
 * budget for what is *wanted* — it is the point past which a runner is taking
 * memory from the process that is supposed to be measuring it. Held without a
 * ceiling, a runaway command exhausts conductor's heap long before the timeout
 * it was given fires, and takes the tick's record of what happened with it.
 *
 * Reaching it stops the command, so it is set generously: four thousand times
 * the tail, far past any real runner's diagnostics, and still bounded.
 */
const STDERR_CEILING = 8 * 1024 * 1024;

/** What running the goal command asks for. */
export interface GoalCheckRequest {
  /** The declared command and its ceiling, straight off the resolved config. */
  readonly goalCheck: ResolvedGoalCheck;
  /** The provisioned workspace the command runs in. */
  readonly cwd: string;
  /** The work item being proved. Appended as the command's final argument. */
  readonly entityId: string;
  /** Extra environment for the child. Defaults to conductor's own. */
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * What a goal run settled to.
 *
 * Three outcomes, not two, and the third is the one that keeps this honest:
 *
 * - `"passed"` / `"failed"` — the command **ran to completion** and said so with
 *   its exit status. This is a statement about the *work*.
 * - `"not-run"` — the command crashed on the way up, could not be found, was
 *   killed, or timed out. This is a statement about **conductor's own
 *   machinery**, and it must never be reported as a failed goal: a missing
 *   runner announced as "the change did not do what the issue asked" sends
 *   somebody to read a diff that is fine.
 */
export type GoalCheckOutcome =
  | { readonly kind: "verdict"; readonly verdict: "passed" | "failed"; readonly exitCode: number }
  | { readonly kind: "not-run"; readonly reason: string };

/** Keep the last {@link REASON_TAIL} characters of a stream, trimmed. */
function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > REASON_TAIL ? `…${trimmed.slice(-REASON_TAIL)}` : trimmed;
}

/**
 * What execa said went wrong, when it is a failure result rather than a status.
 *
 * `originalMessage` is the underlying `spawn … ENOENT`, without the command and
 * output execa's own message repeats — the reason already names the command it
 * tried. Taken through `unknown` because the narrowing is on the *shape* of a
 * result whose type is otherwise pinned to the options it was run with.
 *
 * @param result A settled execa result.
 * @returns The underlying message, or a stand-in when there is none to read.
 */
function failureMessage(result: unknown): string {
  return result instanceof ExecaError ? result.originalMessage : "no reason was reported";
}

/**
 * Run the declared goal command and turn its exit status into an outcome.
 *
 * **Settles; never throws.** The same contract the dispatcher seam holds, for
 * the same reason: a rejected promise skips the ledger, and a transition that
 * skipped the ledger is one no restart can recover. Every way a child process
 * can fail — a bad executable, a crash before exec, a signal, a timeout — comes
 * back as `not-run` with a reason instead. `reject: false` is what makes that
 * one code path rather than a `catch` that has to remember which failures are
 * verdicts: a non-zero exit is the *work* failing and must not be caught with
 * the rest.
 *
 * The child is spawned with `shell: false`, so no element of the argv is parsed
 * for quoting, globbing, redirection or substitution.
 */
export async function runGoalCheckCommand(
  request: GoalCheckRequest,
): Promise<GoalCheckOutcome> {
  const { goalCheck, cwd, entityId, env } = request;
  const rendered = renderCommand(goalCheck.command);
  const [executable, ...rest] = goalCheck.command;
  // Unreachable through `resolveConductor`, which rejects an empty command at
  // open. Answered rather than asserted, because this is the boundary where a
  // hand-built config would otherwise reach `execa(undefined)`.
  if (executable === undefined) {
    return { kind: "not-run", reason: "The declared goal command is empty." };
  }
  // The same boundary, for the other value that arrives here unmediated. Zero
  // and below cannot bound a run, and a run with no bound is a tick that never
  // ends — so it is refused here rather than read as "no ceiling was wanted".
  // (Rejecting it at config open, where the operator would hear about it hours
  // earlier, is a separate and better fix that this does not replace.)
  if (!(goalCheck.timeoutMs > 0)) {
    return {
      kind: "not-run",
      reason:
        `The goal command \`${rendered}\` was given a ceiling of ` +
        `${goalCheck.timeoutMs}ms, which cannot bound a run, so it was not started.`,
    };
  }

  let result;
  try {
    result = await execa(executable, [...rest, entityId], {
      cwd,
      // `extendEnv: false` because a caller that passes `env` is stating the
      // whole environment, the way `child_process.spawn` reads it.
      env: env ?? process.env,
      extendEnv: false,
      shell: false,
      // The verdict is the exit status, so a non-zero one must come back as a
      // value. Throwing it would put it through the same path as a runner that
      // never started, and report failed work as broken machinery.
      reject: false,
      timeout: goalCheck.timeoutMs,
      // The declared command is realistically a wrapper — `pnpm test`, a build
      // script — and the work is in what it spawns. Killing only the direct
      // child leaves those alive to keep writing to a workspace conductor has
      // already finished with. Off by default, hence stated.
      killDescendants: true,
      // stdout is drained and dropped; stderr is kept, bounded, for the tail a
      // `not-run` reason carries.
      buffer: { stdout: false, stderr: true },
      maxBuffer: { stderr: STDERR_CEILING },
    });
  } catch (cause) {
    // `reject: false` covers everything the subprocess does; what is left is
    // execa refusing the request at all (an option it will not accept, a `cwd`
    // that is not a string) — and a throw here would reject rather than settle.
    return {
      kind: "not-run",
      reason:
        `The goal command \`${rendered}\` could not be started: ` +
        `${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  const stderr = typeof result.stderr === "string" ? result.stderr : "";

  if (result.timedOut) {
    return {
      kind: "not-run",
      reason:
        `The goal command \`${rendered}\` did not finish within ` +
        `${goalCheck.timeoutMs}ms and was killed, so it proved nothing either way.`,
    };
  }

  if (result.isMaxBuffer) {
    return {
      kind: "not-run",
      reason:
        `The goal command \`${rendered}\` produced more than ${STDERR_CEILING} bytes of ` +
        `output on stderr and was killed before it could report a verdict.`,
    };
  }

  // Undefined exactly when there is no status to read: the command was killed
  // rather than returned, or never started at all. A signal distinguishes them,
  // and both are the machinery failing rather than the work.
  if (result.exitCode === undefined) {
    if (result.signal !== undefined) {
      return {
        kind: "not-run",
        reason:
          `The goal command \`${rendered}\` was killed by ${result.signal} ` +
          `before it could report a verdict.${stderr ? ` stderr: ${tail(stderr)}` : ""}`,
      };
    }
    return {
      kind: "not-run",
      reason:
        `The goal command \`${rendered}\` could not be executed in ${cwd}: ` +
        `${failureMessage(result)}`,
    };
  }

  // A runner's own PASS/FAIL line is for the human reading the log, which is
  // why stdout is never retained. Grading it here would put the verdict back in
  // prose, which is the thing the exit status exists to replace.
  return {
    kind: "verdict",
    verdict: result.exitCode === 0 ? "passed" : "failed",
    exitCode: result.exitCode,
  };
}
