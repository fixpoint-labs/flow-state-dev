/**
 * The lab's run source admits a session's repository as a project's create
 * did: one the lab lists runs in a worktree of it, and any other must pass
 * the workspace host's repository check (a git repository that ignores
 * `.fsdev/` in a commit) or a source read and a coding run are refused
 * `repository-unusable`. The session's repository is whatever its open wrote,
 * so the check runs where it is used. On the lab's own host, in process, with
 * a scripted model and the scripted coder.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { SET_SESSION_FIELDS_ACTION } from "@flow-state-dev/workforce/browser";
import { scriptedModels } from "../../test-support/contract";
import { openClaudeCodeStyle } from "../host.mts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const done of cleanup.splice(0)) await done();
});

const GIT = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

/** A committed git repository; `ignoresFsdev` commits the `.fsdev/` rule a run's checkout needs. */
function repository(dir: string, ignoresFsdev: boolean): string {
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  writeFileSync(join(dir, "README.md"), "# Notes\n");
  if (ignoresFsdev) writeFileSync(join(dir, ".gitignore"), "**/.fsdev/\n");
  execFileSync("git", ["-C", dir, "add", "-A"], { env: GIT });
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "init"], { env: GIT });
  return execFileSync("realpath", [dir], { encoding: "utf8" }).trim();
}

async function lab(listed: string[], data: string) {
  // The main worker reads the README in its first step, then answers.
  const modelResolver = scriptedModels({
    "agent-answer": ({ step }) => (step === 0 ? { call: { name: "readProjectSource", args: { path: "README.md" } } } : { text: "Read." }),
  }) as never;
  const { flowState } = await openClaudeCodeStyle({ data, userId: "u_lab", model: "test/scripted", utilityModel: "test/utility", repositories: listed, scriptedStepMs: 20, modelResolver });
  cleanup.push(async () => {
    await (flowState as unknown as { dispose?: () => Promise<void> }).dispose?.();
    rmSync(data, { recursive: true, force: true });
  });
  const fsd = createClient({ userId: "u_lab", baseUrl: "", fetcher: createInProcessFetch(flowState as never) as never });
  const agent = fsd.flow("agent");
  const act = async (sessionId: string, action: string, input: unknown) => {
    const { status, error, output } = await (await agent.send(action, input, { sessionId })).result();
    if (status !== "completed") throw new Error(`${action} ended ${status}: ${error?.message ?? ""}`);
    return output as { taskId?: string };
  };
  /** A main session opened on `repository`. */
  const open = async (repository: string) => {
    const session = (await agent.createSession({ state: { workerId: "desk.main" } })).id;
    await act(session, SET_SESSION_FIELDS_ACTION, { worker: "desk.main", fields: { repository } });
    return session;
  };
  /** What the session's README read answered. */
  const read = async (session: string) => {
    await act(session, "respond", { message: "What does the README say?" });
    const state = (await fsd.sessions.state(session, { includeItems: true, itemTypes: ["tool_output"] })) as { items?: { blockName?: string; output?: unknown }[] };
    return state.items?.find((item) => item.blockName === "readProjectSource")?.output as { kind?: string; reason?: string } | undefined;
  };
  /** The coding task the session files, once it ends: its status and error. */
  const run = async (session: string) => {
    const filed = await act(session, "createTask_tasks", { title: "Note it", goal: "Write a note.", assignee: "desk.coder" });
    for (const until = Date.now() + 30_000; Date.now() < until; await new Promise((resolve) => setTimeout(resolve, 200))) {
      const { task } = (await act(session, "getTask_tasks", { id: filed.taskId })) as { task?: { status: string; error?: string } };
      if (task !== undefined && task.status !== "pending" && task.status !== "in_progress") return task;
    }
    throw new Error("the task never ended");
  };
  return { open, read, run };
}

describe("the lab's run source", () => {
  it("refuses a source read and a run in an unlisted repository that doesn't ignore `.fsdev/`", { timeout: 60_000 }, async () => {
    const data = mkdtempSync(join(tmpdir(), "ccs-source-"));
    const bare = repository(join(data, "bare"), false);
    const h = await lab([], data);
    const session = await h.open(pathToFileURL(bare).href);
    expect(await h.read(session)).toMatchObject({ kind: "refused", reason: "repository-unusable" });
    const task = await h.run(session);
    expect(task.status).toBe("errored");
    expect(task.error).toContain("repository-unusable");
  });

  it("still runs a listed repository in a worktree of it", { timeout: 60_000 }, async () => {
    const data = mkdtempSync(join(tmpdir(), "ccs-source-"));
    const ready = repository(join(data, "ready"), true);
    const h = await lab([ready], data);
    const session = await h.open(ready);
    expect(await h.read(session)).toMatchObject({ kind: "read", status: "ok" });
    await h.run(session);
    const worktrees = execFileSync("git", ["-C", ready, "worktree", "list", "--porcelain"], { encoding: "utf8" });
    expect(worktrees).toContain(join(data, "runs"));
  });
});
