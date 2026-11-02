/**
 * A coding run is done only when its project's checks pass: the lab's phase
 * runs them in the run's worktree after the harness says it finished, and a
 * red one sends the run back with the command's output in the next brief.
 *
 * The flow wraps the phase in `commandCheck` with `projectChecks()`; here
 * the same wrap is graded with fixed commands on a real folder, as the
 * manager calls it.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commandCheck, type CompletionRunContext, type PhaseDoneVerdict, type PromptRunContext } from "@flow-state-dev/harness-manager";
import { codePhase } from "../workforce/flows/harness-thread.mts";

/** A worktree whose check is red until `state.txt` says "ok". */
function worktree(state: string) {
  const dir = mkdtempSync(join(tmpdir(), "cc-style-checks-"));
  writeFileSync(join(dir, "state.txt"), `${state}\n`);
  writeFileSync(
    join(dir, "check.mjs"),
    `import { readFileSync } from "node:fs";\nconst s = readFileSync("state.txt", "utf8").trim();\nif (s !== "ok") { console.error("CHECK-MARKER: " + s); process.exit(3); }\n`,
  );
  return dir;
}

const finished = (workspacePath: string) =>
  ({ stopReport: "finished", workspacePath, answer: "done", attempt: 1 }) as unknown as CompletionRunContext;

const verdictOf = (answer: boolean | PhaseDoneVerdict) => (typeof answer === "boolean" ? { done: answer } : answer);

/** The flow's wrap, with fixed commands in place of `projectChecks()`. */
const graded = (commands: readonly string[]) => commandCheck(codePhase, { commands, timeoutMs: 10 * 60_000 });

describe("the lab's coding phase", () => {
  const phase = graded(["node check.mjs"]);

  it("is not done while a check is red, and says which command and why", async () => {
    const verdict = verdictOf(await phase.isDone(finished(worktree("broken"))));
    expect(verdict.done).toBe(false);
    expect(verdict.reason).toContain("node check.mjs");
    expect(verdict.reason).toContain("CHECK-MARKER: broken");
  });

  it("is done when they pass, and when the project names none", async () => {
    expect(verdictOf(await phase.isDone(finished(worktree("ok")))).done).toBe(true);
    expect(verdictOf(await graded([]).isDone(finished(worktree("broken")))).done).toBe(true);
  });

  it("puts why the last attempt stopped in the next brief", async () => {
    const run = { task: { goal: "Fix the build." }, answers: [], feedback: "`node check.mjs` exited 3." } as unknown as PromptRunContext;
    expect(await phase.buildPrompt(run)).toContain("Why the last attempt stopped:\n\n`node check.mjs` exited 3.");
    expect(await phase.buildPrompt({ ...run, feedback: undefined } as PromptRunContext)).not.toContain("Why the last attempt stopped");
  });
});
