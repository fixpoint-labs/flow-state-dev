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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RUNS, runRecordCollection, readRunRow, runTopic } from "./run-record";
import type { PhaseRunContext, PhaseSpec } from "./manager";

const run = promisify(execFile);

export interface ImplementPhaseOptions {
  /**
   * Does a pull request exist for this branch? Injectable so a deterministic
   * test can stage both arms of the conjunction without a network.
   */
  prExists?: (run: PhaseRunContext) => boolean | Promise<boolean>;
}

/**
 * Ask GitHub whether this branch has a pull request.
 *
 * Run from inside the run's own checkout, so `gh` resolves the repository from
 * where the work happened rather than from wherever the server sits.
 */
async function prExistsViaGh(ctx: PhaseRunContext): Promise<boolean> {
  const { stdout } = await run(
    "gh",
    ["pr", "list", "--head", ctx.branch, "--state", "all", "--json", "number"],
    { cwd: ctx.workspacePath, maxBuffer: 4 * 1024 * 1024 },
  );
  const rows = JSON.parse(stdout || "[]") as unknown[];
  return rows.length > 0;
}

/** Build the implement phase. */
export function implementPhase(options: ImplementPhaseOptions = {}): PhaseSpec {
  const prExists = options.prExists ?? prExistsViaGh;

  return {
    phase: "implement",
    // The prompt reads this issue's own row, so a second attempt can be told
    // where it is picking up from rather than being handed a bare instruction.
    readable: { [RUNS]: runRecordCollection },

    async buildPrompt(ctx: PhaseRunContext): Promise<string> {
      const previous = await readRunRow(ctx.ctx, runTopic(ctx.issue, ctx.phase));
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

      if (previous?.sessionId != null) {
        lines.push("", `The previous run's harness session was ${previous.sessionId}.`);
      }

      return lines.join("\n");
    },

    isDone: (ctx) => prExists(ctx),
  };
}
