/**
 * The working folder's checks: a coding run is done only when they pass in
 * its worktree, and a red one sends it back with the command's output in the
 * next brief. `fsdev.config.mts` reads them from `TEAMMATES_CHECKS` and the
 * setup command from `TEAMMATES_SETUP`; a command a shell would be needed for
 * stops the lab at start.
 *
 * The phase is graded on a real folder with real commands, as the manager
 * calls it after a run its harness says finished.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CompletionRunContext, PhaseDoneVerdict, PromptRunContext } from "@flow-state-dev/harness-manager";
import { codingPhase } from "../src/flows/coder";
import { checkCommands, setupCommand } from "../host.mts";

// The brief opens with the worker's instructions, read off the turn's loaded worker
// (`worker-instructions.test.ts` covers that); a worker with none here.
vi.mock("@flow-state-dev/workforce", async (original) => ({
  ...(await original<typeof import("@flow-state-dev/workforce")>()),
  workerConfigOf: () => ({}),
}));

/** A worktree whose check is red until `state.txt` says "ok". */
function worktree(state: string) {
  const dir = mkdtempSync(join(tmpdir(), "teammates-checks-"));
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

describe("a coding run with the working folder's checks", () => {
  const phase = codingPhase({ commands: ["node check.mjs"], timeoutMs: 20_000 });

  it("is not done while a check is red, and says which command and why", async () => {
    const verdict = verdictOf(await phase.isDone(finished(worktree("broken"))));
    expect(verdict.done).toBe(false);
    expect(verdict.reason).toContain("node check.mjs");
    expect(verdict.reason).toContain("CHECK-MARKER: broken");
  });

  it("is done when they pass", async () => {
    expect(verdictOf(await phase.isDone(finished(worktree("ok")))).done).toBe(true);
  });

  it("is done on the same red folder when the host names no checks", async () => {
    expect(verdictOf(await codingPhase(undefined).isDone(finished(worktree("broken")))).done).toBe(true);
    // The host always passes `checks`, with no commands when the operator named none.
    expect(verdictOf(await codingPhase({ commands: [], timeoutMs: 20_000 }).isDone(finished(worktree("broken")))).done).toBe(true);
  });

  it("puts why the last attempt stopped in the next brief", async () => {
    const run = { task: { goal: "Fix the build." }, workspacePath: "/w", feedback: "`node check.mjs` exited 3." } as unknown as PromptRunContext;
    expect(await phase.buildPrompt(run)).toContain("Why the last attempt stopped:\n\n`node check.mjs` exited 3.");
    expect(await phase.buildPrompt({ ...run, feedback: undefined } as PromptRunContext)).not.toContain("Why the last attempt stopped");
  });
});

describe("the checks and setup settings", () => {
  it("read nothing when unset or blank", () => {
    expect(checkCommands(undefined)).toBeUndefined();
    expect(checkCommands("  ")).toBeUndefined();
    expect(setupCommand(undefined)).toBeUndefined();
  });

  it("read `;`-separated checks and one setup command, split into words", () => {
    expect(checkCommands("pnpm typecheck; pnpm --filter web test")).toEqual(["pnpm typecheck", "pnpm --filter web test"]);
    expect(setupCommand("pnpm install --frozen-lockfile")).toEqual({ command: ["pnpm", "install", "--frozen-lockfile"] });
  });

  it("refuse a command that needs a shell, naming the setting", () => {
    expect(() => checkCommands("pnpm build && pnpm test")).toThrow(/TEAMMATES_CHECKS: .*shell operator/);
    expect(() => setupCommand("pnpm install | tee log")).toThrow(/TEAMMATES_SETUP: .*shell operator/);
    expect(() => setupCommand("pnpm install; pnpm build")).toThrow(/TEAMMATES_SETUP: .*shell operator/);
  });
});
