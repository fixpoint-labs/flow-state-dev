/**
 * The implement phase — the one set of phase values this lab ships.
 *
 * Three values, handed to the manager: what to say to the run, how to tell the
 * job is done, and which collections the prompt may read. A record type, a
 * registry, or a second phase module would be abstraction for a set of one.
 * The spec and review phases arrive with a second shape to generalise from.
 *
 * **The done-condition is `a pull request exists for this issue-phase`, and it
 * is never an alternative route to completion** — the manager consults it only
 * after a successful verdict, because a run can open the pull request and then
 * exhaust its turn budget.
 */
import type { PhaseRunContext, PhaseSpec } from "./manager";
import { NETWORK_CALL_TIMEOUT_MS, run } from "./exec";

export interface ImplementPhaseOptions {
  /**
   * Does a pull request exist for this branch? Injectable so a deterministic
   * test can stage both arms of the conjunction without a network.
   */
  prExists?: (run: PhaseRunContext) => boolean | Promise<boolean>;
}

/**
 * The pull-request states that count as "this phase produced something".
 *
 * **`CLOSED` is excluded, and that exclusion is the whole point.** A branch
 * whose pull request was opened and then closed WITHOUT merging still has a row
 * on GitHub. Counting it means a later attempt that exits cleanly completes the
 * task with no open and no merged pull request anywhere — a silent success,
 * which is the exact defect class this lab exists to close, re-entering through
 * the completion check itself.
 *
 * Not hypothetical: a closed-unmerged pull request is an ordinary artifact of
 * this repo's own process (every spec PR closes unmerged by design).
 */
const COMPLETING_PR_STATES = new Set(["OPEN", "MERGED"]);

/**
 * Does this branch have a pull request that counts?
 *
 * Split from the `gh` call so the state rule is testable without a network —
 * the rule is the part that can be wrong, and the part a reviewer needs pinned.
 * Tolerates a row with no `state` by rejecting it (BP-030): an answer we cannot
 * classify must not complete a task.
 */
export function hasCompletingPr(stdout: string): boolean {
  let rows: unknown;
  try {
    rows = JSON.parse(stdout || "[]");
  } catch {
    return false;
  }
  if (!Array.isArray(rows)) return false;
  return rows.some((row) =>
    COMPLETING_PR_STATES.has(String((row as { state?: unknown } | null)?.state)),
  );
}

/**
 * Ask GitHub whether this branch has a pull request that counts.
 *
 * Run from inside the run's own checkout, so `gh` resolves the repository from
 * where the work happened rather than from wherever the server sits.
 *
 * `--state all` is still passed, deliberately: the alternative — asking only for
 * open ones — would miss a run that opened a PR and had it merged before the
 * verdict was read. The state is requested and judged here instead.
 */
async function prExistsViaGh(ctx: PhaseRunContext): Promise<boolean> {
  const { stdout } = await run(
    "gh",
    ["pr", "list", "--head", ctx.branch, "--state", "all", "--json", "number,state"],
    {
      cwd: ctx.workspacePath,
      // Bounded twice. Without either, a listing that never answers holds the
      // row `in_progress` past the paid agent it was reporting on — the worker
      // does not return, so nothing settles and the attempt is charged anyway.
      timeoutMs: NETWORK_CALL_TIMEOUT_MS,
      signal: ctx.ctx.signal,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  return hasCompletingPr(stdout);
}

/** Build the implement phase. */
export function implementPhase(options: ImplementPhaseOptions = {}): PhaseSpec {
  const prExists = options.prExists ?? prExistsViaGh;

  return {
    phase: "implement",
    // Empty, and that is not an oversight: this phase reads no collection of its
    // own. It does not read the run record either — everything it needs about
    // the previous attempt arrives on `PhaseRunContext`, because that row
    // describes the attempt now running and has already been cleared by the
    // time a prompt is built.
    //
    // `runs` is the MANAGER's collection regardless — always declared, and
    // reserved, because a phase re-declaring it would replace the manager's own
    // and send its bookkeeping somewhere `status` never reads. `readable` is for
    // collections a phase brings of its own.
    readable: {},

    buildPrompt(ctx: PhaseRunContext): string {
      const lines = [
        `Implement Linear issue ${ctx.issue}.`,
        "",
        `You are working in ${ctx.workspacePath}, on branch ${ctx.branch}.`,
        "Commit your work and open a pull request for that branch when the change is done.",
      ];

      if (ctx.attempt > 1) {
        lines.push(
          "",
          `This is attempt ${ctx.attempt}. The checkout still holds whatever the last`,
          "attempt left behind, uncommitted work included — read it before you start,",
          "and continue rather than beginning again.",
        );
      }

      // The carry-forward decision 2's economics rest on. It comes from the
      // board's own `feedback` field, captured when `fail()` re-pended the row —
      // never from the run record, which keeps only the last outcome and is
      // overwritten when this attempt opens.
      if (ctx.feedback !== undefined && ctx.feedback !== "") {
        lines.push("", "The last attempt stopped for this reason:", ctx.feedback);
      }

      // From the MANAGER, not from the run record. The record's `sessionId`
      // describes the attempt now running, and this attempt's opening write
      // cleared it before a prompt could be built — so reading it here always
      // saw `null` and the previous session was silently never named. The
      // manager captures it before the clear and hands it over.
      if (ctx.previousSessionId !== undefined) {
        lines.push("", `The previous run's harness session was ${ctx.previousSessionId}.`);
      }

      return lines.join("\n");
    },

    isDone: (ctx) => prExists(ctx),
  };
}
