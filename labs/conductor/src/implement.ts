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
import { readRunRow, runTopic } from "./run-record";
import type { PhaseRunContext, PhaseSpec, PromptRunContext } from "./manager";
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
    // Empty, and that is not an oversight. The prompt below reads this issue's
    // run row, but `runs` is the MANAGER's collection — always declared, and
    // reserved, because a phase re-declaring it would replace the manager's own
    // and send its bookkeeping somewhere `status` never reads. `readable` is for
    // collections a phase brings of its own.
    readable: {},

    async buildPrompt(ctx: PromptRunContext): Promise<string> {
      const previous = await readRunRow(ctx.ctx, runTopic(ctx.epic, ctx.issue, ctx.phase));
      const lines = [
        `Implement Linear issue ${ctx.issue}.`,
        "",
        `You are working in ${ctx.workspacePath}, on branch ${ctx.branch}.`,
        "Commit your work and open a pull request for that branch when the change is done.",
        "",
        // **The forced ask.** The harness offers no seam for a question, so this
        // instruction IS the seam: nothing else tells the run how to reach a
        // person, and a run that ignores it takes the ordinary no-question
        // failure path. Written imperatively, with the path spelled in full and
        // the ordering constraint stated, because both are load-bearing and a
        // reworded version of either is a question nobody ever sees.
        "If you hit an ambiguity you genuinely cannot resolve — a decision that",
        "belongs to a person rather than to you — do NOT guess and do NOT stop",
        "silently. Write the question, and only the question, to this exact file:",
        "",
        `  ${ctx.askMarkerPath}`,
        "",
        "Write it BEFORE you open the pull request, then stop working. The file is",
        "already gitignored, so it will not be committed. Someone will answer it and",
        "your run will be started again holding the answer. Only write that file if",
        "you actually have a question — an empty or leftover file is not one.",
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

      // **The other channel, and it never carries the one above.** These are
      // answers a person gave to questions this run asked; `feedback` is why an
      // attempt failed. Handing an answer back through `feedback` is the
      // cheapest wiring and would tell the run *"your last attempt stopped
      // because: take the second option."*
      //
      // Oldest first, ordered by the manager. Every answered row for this
      // issue-phase across every attempt — the question history, not a
      // freshness assumption — and folding it is idempotent, so a replay builds
      // the same prompt.
      if (ctx.answers.length > 0) {
        lines.push("", "Questions you asked earlier have been answered:");
        for (const { question, answer } of ctx.answers) {
          lines.push("", `  You asked: ${question}`, `  The answer: ${answer}`);
        }
        lines.push("", "Continue on those answers.");
      }

      if (previous?.sessionId != null) {
        lines.push("", `The previous run's harness session was ${previous.sessionId}.`);
      }

      return lines.join("\n");
    },

    isDone: (ctx) => prExists(ctx),
  };
}
