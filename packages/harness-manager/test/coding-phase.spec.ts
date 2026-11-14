/**
 * The coding worker flow's phase: a run's brief, and when a run is done.
 *
 * The brief opens with the worker's own instructions (its `WORKER.md` body),
 * then the task, then why the last attempt stopped. A run is done when its
 * harness says it finished and, on a run that changed files, the kit's checks
 * pass in its worktree: a red one sends it back with the command's output in
 * the next brief. Graded on a real folder with real commands, as the manager
 * calls the phase after a run its harness says finished.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CompletionRunContext, PhaseDoneVerdict, PromptRunContext } from "../src";
import { codingPhase } from "../src/kit/coder-flow";

let loaded: Record<string, unknown> = {};
vi.mock("@flow-state-dev/workforce", async (original) => ({
  ...(await original<typeof import("@flow-state-dev/workforce")>()),
  workerConfigOf: () => loaded,
}));

/** A worktree whose check is red until `state.txt` says "ok". */
function worktree(state: string) {
  const dir = mkdtempSync(join(tmpdir(), "coding-phase-"));
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

describe("a coding run with the kit's checks", () => {
  const phase = codingPhase({ checks: { commands: ["node check.mjs"], timeoutMs: 20_000 } });

  it("is not done while a check is red, and says which command and why", async () => {
    const verdict = verdictOf(await phase.isDone(finished(worktree("broken"))));
    expect(verdict.done).toBe(false);
    expect(verdict.reason).toContain("node check.mjs");
    expect(verdict.reason).toContain("CHECK-MARKER: broken");
  });

  it("is done when they pass", async () => {
    expect(verdictOf(await phase.isDone(finished(worktree("ok")))).done).toBe(true);
  });

  it("is done on the same red folder when the kit names no checks", async () => {
    expect(verdictOf(await codingPhase({}).isDone(finished(worktree("broken")))).done).toBe(true);
    expect(verdictOf(await codingPhase({ checks: { commands: [] } }).isDone(finished(worktree("broken")))).done).toBe(true);
  });

  it("puts why the last attempt stopped in the next brief", async () => {
    loaded = {};
    const run = { ctx: { session: {} }, task: { goal: "Fix the build." }, answers: [], workspacePath: "/w", feedback: "`node check.mjs` exited 3." } as unknown as PromptRunContext;
    expect(await phase.buildPrompt(run)).toContain("Why the last attempt stopped:\n\n`node check.mjs` exited 3.");
    expect(await phase.buildPrompt({ ...run, feedback: undefined } as PromptRunContext)).not.toContain("Why the last attempt stopped");
  });
});

describe("a coding run's brief", () => {
  const BODY = "You run coding tasks. Leave a haiku in the commit message.";
  const run = {
    ctx: { session: {} },
    task: { title: "Add a line to the README", goal: "Add a line that says hi to README.md, and commit it." },
    answers: [],
    workspacePath: "/w",
  } as unknown as PromptRunContext;

  it("opens with the worker's instructions, before the task's goal", async () => {
    loaded = { instructions: BODY };
    const prompt = await codingPhase({}).buildPrompt(run);
    expect(prompt).toContain(BODY);
    expect(prompt.indexOf(BODY)).toBeLessThan(prompt.indexOf("Add a line that says hi to README.md"));
  });

  it("is the task alone for a worker with no instructions", async () => {
    loaded = {};
    const prompt = await codingPhase({}).buildPrompt(run);
    expect(prompt.startsWith("Task: Add a line to the README")).toBe(true);
  });
});
