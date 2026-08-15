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

import { spawn } from "node:child_process";

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
 * Run the declared goal command and turn its exit status into an outcome.
 *
 * **Settles; never throws.** The same contract the dispatcher seam holds, for
 * the same reason: a rejected promise skips the ledger, and a transition that
 * skipped the ledger is one no restart can recover. Every way a child process
 * can fail — a bad executable, a crash before exec, a signal, a timeout — comes
 * back as `not-run` with a reason instead.
 *
 * The child is spawned with `shell: false` (node's default), so no element of
 * the argv is parsed for quoting, globbing, redirection or substitution.
 */
export async function runGoalCheckCommand(
  request: GoalCheckRequest,
): Promise<GoalCheckOutcome> {
  const { goalCheck, cwd, entityId, env } = request;
  const [executable, ...rest] = goalCheck.command;
  // Unreachable through `resolveConductor`, which rejects an empty command at
  // open. Answered rather than asserted, because this is the boundary where a
  // hand-built config would otherwise reach `spawn(undefined)`.
  if (executable === undefined) {
    return { kind: "not-run", reason: "The declared goal command is empty." };
  }
  const argv = [...rest, entityId];

  return new Promise<GoalCheckOutcome>((resolve) => {
    let settled = false;
    const settle = (outcome: GoalCheckOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, argv, { cwd, env: env ?? process.env, shell: false });
    } catch (cause) {
      // `spawn` normally reports failure on the `error` event, but an invalid
      // argument (a cwd that is not a string, an argv element that is not) is a
      // synchronous throw — and a throw here would reject rather than settle.
      return resolve({
        kind: "not-run",
        reason:
          `The goal command \`${renderCommand(goalCheck.command)}\` could not be started: ` +
          `${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }

    let stderr = "";
    let stdout = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle({
        kind: "not-run",
        reason:
          `The goal command \`${renderCommand(goalCheck.command)}\` did not finish within ` +
          `${goalCheck.timeoutMs}ms and was killed, so it proved nothing either way.`,
      });
    }, goalCheck.timeoutMs);
    // A goal runner outliving the tick is a hung tick; a timer outliving it is
    // a process that will not exit. Both are avoidable, and only one of them is
    // the child's fault.
    timer.unref?.();

    child.on("error", (cause) => {
      settle({
        kind: "not-run",
        reason:
          `The goal command \`${renderCommand(goalCheck.command)}\` could not be executed in ` +
          `${cwd}: ${cause.message}`,
      });
    });

    child.on("close", (code, signal) => {
      // Killed rather than returned. The timeout path has already settled with
      // a reason of its own; anything else here is a crash (a segfault, an
      // OOM kill), which is the machinery failing rather than the work.
      if (code === null) {
        settle({
          kind: "not-run",
          reason:
            `The goal command \`${renderCommand(goalCheck.command)}\` was killed by ${signal} ` +
            `before it could report a verdict.${stderr ? ` stderr: ${tail(stderr)}` : ""}`,
        });
        return;
      }
      settle({ kind: "verdict", verdict: code === 0 ? "passed" : "failed", exitCode: code });
    });

    // Read but deliberately not acted on: a goal runner's own PASS/FAIL line is
    // for the human reading the log. Grading it here would put the verdict back
    // in prose, which is the thing the exit status exists to replace.
    void stdout;
  });
}
