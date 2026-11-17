/**
 * The host's checks: the commands the operator names (`checks`, read from
 * `CLAUDE_CODE_STYLE_CHECKS`) run in every coding run's own worktree once the
 * run has changed files; a passing one lets the run settle, a failing one sends
 * it back. Not a project's: the lab runs no project checks. On the lab's own
 * host, in process, with the scripted coder; the verdict reads the run records
 * in the lab's store.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { SET_SESSION_FIELDS_ACTION } from "@flow-state-dev/workforce/browser";
import { scriptedModels } from "../../test-support/contract";
import { checkCommands, openClaudeCodeStyle } from "../host.mts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const done of cleanup.splice(0)) await done();
});

/** The file only the test repository commits: a check that finds it ran in a checkout of that repository. */
const MARKER = "CHECKED-HERE.md";

/** A repository the lab may cut from: committed, ignoring `.fsdev/`, holding {@link MARKER}. */
function repository(dir: string): string {
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  writeFileSync(join(dir, ".gitignore"), "**/.fsdev/\n");
  writeFileSync(join(dir, MARKER), "# Only this repository has me\n");
  execFileSync("git", ["-C", dir, "add", "-A"], { env });
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "init"], { env });
  return execFileSync("realpath", [dir], { encoding: "utf8" }).trim();
}

type Check = { command: string; exitCode: number | null; timedOut: boolean; skipped: boolean };
type RunEntry = { outcome: string | null; checks: Check[] | null };

/** Each coding run's record, from the lab's store. */
function runEntries(dbFile: string): RunEntry[] {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const stored = db.prepare("SELECT state FROM resource_state WHERE resource_key LIKE 'runs/%'").all() as { state: string }[];
    return stored.map((entry) => JSON.parse(entry.state) as RunEntry);
  } finally {
    db.close();
  }
}

/** A lab whose host's checks are `value`, with a `desk.coder` task filed in a session on its repository; its store. */
async function fileWithChecks(value: string): Promise<string> {
  const data = mkdtempSync(join(tmpdir(), "ccs-checks-"));
  const repo = repository(join(data, "repo"));
  const { flowState } = await openClaudeCodeStyle({
    data,
    userId: "u_lab",
    model: "test/scripted",
    utilityModel: "test/utility",
    repositories: [repo],
    scriptedStepMs: 20,
    checks: checkCommands(value),
    // No model is asked for anything this check reads: every call gets a plain answer.
    modelResolver: scriptedModels({}, () => ({ text: "ok" })) as never,
  });
  cleanup.push(async () => {
    await (flowState as unknown as { dispose?: () => Promise<void> }).dispose?.();
    rmSync(data, { recursive: true, force: true });
  });
  const fsd = createClient({ userId: "u_lab", baseUrl: "", fetcher: createInProcessFetch(flowState as never) as never });
  const agent = fsd.flow("agent");
  const act = async (sessionId: string, action: string, input: unknown) => {
    const { status, error } = await (await agent.send(action, input, { sessionId })).result();
    if (status !== "completed") throw new Error(`${action} ended ${status}: ${error?.message ?? ""}`);
  };
  const session = (await agent.createSession({ state: { workerId: "desk.main" } })).id;
  await act(session, SET_SESSION_FIELDS_ACTION, { worker: "desk.main", fields: { repository: repo } });
  await act(session, "createTask_tasks", { title: "Note it", goal: "Write a note.", assignee: "desk.coder" });
  return join(data, "lab.db");
}

/** Read `found` until it answers, or 45 s pass. */
async function until<T>(found: () => T | undefined): Promise<T | undefined> {
  for (const end = Date.now() + 45_000; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 250))) {
    const value = found();
    if (value !== undefined) return value;
  }
  return undefined;
}

describe("the host's checks", () => {
  it("run in the coding run's own checkout, and a passing one settles the run", { timeout: 60_000 }, async () => {
    // Tracked only in the test repository: in any other folder git finds no such file and exits non-zero.
    const command = `git ls-files --error-unmatch ${MARKER}`;
    const db = await fileWithChecks(command);
    const settled = await until(() => runEntries(db).find((entry) => entry.outcome === "succeeded" || entry.outcome === "failed"));
    expect(settled?.outcome).toBe("succeeded");
    expect(settled?.checks).toEqual([expect.objectContaining({ command, exitCode: 0, timedOut: false, skipped: false })]);
  });

  it("send the run back when one fails: it never settles as succeeded", { timeout: 60_000 }, async () => {
    const command = "git ls-files --error-unmatch NOT-IN-THE-REPOSITORY.md";
    const db = await fileWithChecks(command);
    const failed = await until(() => runEntries(db).find((entry) => entry.checks?.some((check) => check.command === command && check.exitCode !== 0)));
    expect(failed?.checks).toEqual([expect.objectContaining({ command, exitCode: 1 })]);
    expect(runEntries(db).some((entry) => entry.outcome === "succeeded")).toBe(false);
  });

  it("are read from a `;`-separated value, and a command that needs a shell stops the start", () => {
    expect(checkCommands(" pnpm typecheck ; pnpm test ")).toEqual(["pnpm typecheck", "pnpm test"]);
    expect(checkCommands("  ")).toBeUndefined();
    expect(() => checkCommands("pnpm test && pnpm lint")).toThrow(/^CLAUDE_CODE_STYLE_CHECKS: /);
  });
});
