/**
 * The coding worker flow's mode: a run's brief, and when a run is done.
 *
 * The brief opens with the worker's own instructions (its `WORKER.md` body),
 * then the task, then why the last attempt stopped. A run is done when its
 * harness says it finished and, on a run that changed files, the kit's checks
 * pass in its worktree: a red one sends it back with the command's output in
 * the next brief. Graded on a real folder with real commands, as the manager
 * calls the mode after a run its harness says finished.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CompletionRunContext, ModeDoneVerdict, PromptRunContext } from "../src";
import { codingMode } from "../src/kit/coder-flow";

let loaded: Record<string, unknown> = {};
vi.mock("@flow-state-dev/workforce", async (original) => ({
  ...(await original<typeof import("@flow-state-dev/workforce")>()),
  workerConfigOf: () => loaded,
}));

/** A worktree whose check is red until `state.txt` says "ok". */
function worktree(state: string) {
  const dir = mkdtempSync(join(tmpdir(), "coding-mode-"));
  writeFileSync(join(dir, "state.txt"), `${state}\n`);
  writeFileSync(
    join(dir, "check.mjs"),
    `import { readFileSync } from "node:fs";\nconst s = readFileSync("state.txt", "utf8").trim();\nif (s !== "ok") { console.error("CHECK-MARKER: " + s); process.exit(3); }\n`,
  );
  return dir;
}

const finished = (workspacePath: string) =>
  ({ stopReport: "finished", workspacePath, answer: "done", attempt: 1 }) as unknown as CompletionRunContext;

const verdictOf = (answer: boolean | ModeDoneVerdict) => (typeof answer === "boolean" ? { done: answer } : answer);

describe("a coding run with the kit's checks", () => {
  const mode = codingMode({ checks: { commands: ["node check.mjs"], timeoutMs: 20_000 } });

  it("is not done while a check is red, and says which command and why", async () => {
    const verdict = verdictOf(await mode.doneWhen.check(finished(worktree("broken"))));
    expect(verdict.done).toBe(false);
    expect(verdict.reason).toContain("node check.mjs");
    expect(verdict.reason).toContain("CHECK-MARKER: broken");
  });

  it("is done when they pass", async () => {
    expect(verdictOf(await mode.doneWhen.check(finished(worktree("ok")))).done).toBe(true);
  });

  it("is done on the same red folder when the kit names no checks", async () => {
    expect(verdictOf(await codingMode({}).doneWhen.check(finished(worktree("broken")))).done).toBe(true);
    expect(verdictOf(await codingMode({ checks: { commands: [] } }).doneWhen.check(finished(worktree("broken")))).done).toBe(true);
  });

  it("puts why the last attempt stopped in the next brief", async () => {
    loaded = {};
    const run = { ctx: { session: {} }, task: { goal: "Fix the build." }, answers: [], workspacePath: "/w", feedback: "`node check.mjs` exited 3." } as unknown as PromptRunContext;
    expect(await mode.instructions(run)).toContain("# Why the last attempt stopped\n\n`node check.mjs` exited 3.");
    expect(await mode.instructions({ ...run, feedback: undefined } as PromptRunContext)).not.toContain("Why the last attempt stopped");
  });

  it("names the checks in the brief, before the run has changed anything", async () => {
    // The brief is built before the run, so the changed-files filter that skips the checks for a question must not hide them here.
    loaded = {};
    const run = { ctx: { session: {} }, task: { goal: "Fix the build." }, answers: [], workspacePath: "/w" } as unknown as PromptRunContext;
    const prompt = await mode.instructions(run);
    expect(prompt).toContain("- `node check.mjs`");
    expect(prompt).toMatch(/decide whether the task is done/);
    expect(await codingMode({}).instructions(run)).not.toContain("# The checks");
  });
});

describe("a coding run's brief", () => {
  const BODY = "You run coding tasks. Leave a haiku in the commit message.";
  const run = {
    ctx: { session: {} },
    task: { title: "Add a line to the README", goal: "Add a line that says hi to README.md, and commit it.", context: "The README is in the root." },
    answers: [],
    workspacePath: "/w",
  } as unknown as PromptRunContext;

  it("carries the task and its context, then the worker's instructions", async () => {
    loaded = { instructions: BODY };
    const prompt = await codingMode({}).instructions(run);
    expect(prompt).toContain("The README is in the root.");
    expect(prompt.indexOf("Add a line that says hi to README.md")).toBeLessThan(prompt.indexOf(BODY));
  });

  it("asks a question to be answered and a change to be committed, then a report", async () => {
    loaded = {};
    const prompt = await codingMode({}).instructions(run);
    expect(prompt).toMatch(/If the task asks a question, read what you need, answer it in full, and change nothing/);
    expect(prompt).toMatch(/# Your report/);
  });
});

describe("the kit's one mode", () => {
  // Its runs' keys end in its name. Runs stored before modes had names ended in
  // `code`, so that is its former name: a run in flight across the rename is
  // still found (BP-030; `mode-former-name.spec.ts` proves the read).
  it("is `default`, formerly `code`, with checks or without", () => {
    for (const mode of [codingMode({}), codingMode({ checks: { commands: ["node check.mjs"] } })]) {
      expect(mode.name).toBe("default");
      expect(mode.formerName).toBe("code");
    }
  });
});
