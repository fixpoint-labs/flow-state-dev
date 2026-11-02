/**
 * A coding run is done only when its project's checks pass: the lab's phase
 * runs them in the run's worktree after the harness says it finished, and a
 * red one sends the run back with the command's output in the next brief.
 *
 * The flow hands the phase `projectChecks()`, the project row's `checks`;
 * here the phase is graded with fixed commands on a real worktree, as the
 * manager calls it. A run that changed nothing (a question) skips them.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CompletionRunContext, PhaseDoneVerdict, PromptRunContext } from "@flow-state-dev/harness-manager";
import { codePhase } from "../workforce/flows/harness-thread.mts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });

/**
 * A run's worktree, cut the way the workspace host cuts one (`git worktree add -B`), from a base
 * whose check is red until `state.txt` says "ok". `change` is what the run then did to it.
 */
function worktree(base: string, change: "none" | { state: string; commit: boolean } = "none") {
  const repo = mkdtempSync(join(tmpdir(), "cc-style-checks-"));
  git(repo, "init", "--quiet", "-b", "main");
  writeFileSync(join(repo, "state.txt"), `${base}\n`);
  writeFileSync(
    join(repo, "check.mjs"),
    `import { readFileSync } from "node:fs";\nconst s = readFileSync("state.txt", "utf8").trim();\nif (s !== "ok") { console.error("CHECK-MARKER: " + s); process.exit(3); }\n`,
  );
  git(repo, "add", ".");
  git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "base");
  const dir = join(repo, "run");
  git(repo, "worktree", "add", "--quiet", "-B", BRANCH, dir, "main");
  if (change !== "none") {
    writeFileSync(join(dir, "state.txt"), `${change.state}\n`);
    if (change.commit) git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-am", "change");
  }
  return dir;
}

const BRANCH = "fsd/run-1";

const finished = (workspacePath: string) =>
  ({ stopReport: "finished", workspacePath, branch: BRANCH, answer: "done", attempt: 1 }) as unknown as CompletionRunContext;

const verdictOf = (answer: boolean | PhaseDoneVerdict) => (typeof answer === "boolean" ? { done: answer } : answer);

describe("the lab's coding phase", () => {
  const phase = codePhase(["node check.mjs"]);

  it("is not done while a check is red, and says which command and why", async () => {
    const verdict = verdictOf(await phase.isDone(finished(worktree("ok", { state: "broken", commit: true }))));
    expect(verdict.done).toBe(false);
    expect(verdict.reason).toContain("node check.mjs");
    expect(verdict.reason).toContain("CHECK-MARKER: broken");
    // A change left uncommitted is still a change.
    expect(verdictOf(await phase.isDone(finished(worktree("ok", { state: "broken", commit: false })))).done).toBe(false);
  });

  it("skips them on a run that changed nothing, so a question on a red branch still ends", async () => {
    expect(verdictOf(await phase.isDone(finished(worktree("broken")))).done).toBe(true);
    // The same red branch with a change on it is checked: the skip is the run's, not the branch's.
    expect(verdictOf(await phase.isDone(finished(worktree("broken", { state: "still-broken", commit: true })))).done).toBe(false);
  });

  it("is done when they pass, and when the project names none", async () => {
    expect(verdictOf(await phase.isDone(finished(worktree("broken", { state: "ok", commit: true })))).done).toBe(true);
    expect(verdictOf(await codePhase([]).isDone(finished(worktree("ok", { state: "broken", commit: true })))).done).toBe(true);
  });

  it("puts why the last attempt stopped in the next brief", async () => {
    const run = { task: { goal: "Fix the build." }, answers: [], feedback: "`node check.mjs` exited 3." } as unknown as PromptRunContext;
    expect(await phase.buildPrompt(run)).toContain("Why the last attempt stopped:\n\n`node check.mjs` exited 3.");
    expect(await phase.buildPrompt({ ...run, feedback: undefined } as PromptRunContext)).not.toContain("Why the last attempt stopped");
  });
});
