/**
 * The host's checks: the commands the operator names (`checks`, read from
 * `CLAUDE_CODE_STYLE_CHECKS`) run in every coding run's worktree once the run
 * has changed files, and the run's record holds what ran. Not a project's: the
 * lab runs no project checks. On the lab's own host, in process, with the
 * scripted coder; the verdict reads the run record in the lab's store.
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
import { checkCommands, openLab } from "../host.mts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const done of cleanup.splice(0)) await done();
});

/** A repository the lab may cut from: committed, ignoring `.fsdev/`. */
function repository(dir: string): string {
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  writeFileSync(join(dir, ".gitignore"), "**/.fsdev/\n");
  execFileSync("git", ["-C", dir, "add", "-A"], { env });
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "init"], { env });
  return execFileSync("realpath", [dir], { encoding: "utf8" }).trim();
}

/** The checks each coding run's record holds, from the lab's store. */
function recordedChecks(dbFile: string): unknown[] {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const records = db.prepare("SELECT state FROM resource_state WHERE resource_key LIKE 'runs/%'").all() as { state: string }[];
    return records.map((entry) => (JSON.parse(entry.state) as { checks: unknown }).checks).filter((checks) => checks != null);
  } finally {
    db.close();
  }
}

describe("the host's checks", () => {
  it("run in a coding run's worktree, and its record holds them", { timeout: 60_000 }, async () => {
    const data = mkdtempSync(join(tmpdir(), "ccs-checks-"));
    const repo = repository(join(data, "repo"));
    const command = "node -e process.exit(0)";
    const { flowState } = await openLab({
      data,
      userId: "u_lab",
      model: "test/scripted",
      utilityModel: "test/utility",
      repositories: [repo],
      scriptedStepMs: 20,
      checks: checkCommands(command),
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
      const { status, error, output } = await (await agent.send(action, input, { sessionId })).result();
      if (status !== "completed") throw new Error(`${action} ended ${status}: ${error?.message ?? ""}`);
      return output as { taskId?: string };
    };
    const session = (await agent.createSession({ state: { workerId: "desk.main" } })).id;
    await act(session, SET_SESSION_FIELDS_ACTION, { worker: "desk.main", fields: { repository: repo } });
    await act(session, "createTask_tasks", { title: "Note it", goal: "Write a note.", assignee: "desk.coder" });

    let checks: unknown[] = [];
    for (const until = Date.now() + 45_000; checks.length === 0 && Date.now() < until; ) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      checks = recordedChecks(join(data, "lab.db"));
    }
    expect(JSON.stringify(checks)).toContain(command);
  });

  it("are read from a `;`-separated value, and a command that needs a shell stops the start", () => {
    expect(checkCommands(" pnpm typecheck ; pnpm test ")).toEqual(["pnpm typecheck", "pnpm test"]);
    expect(checkCommands("  ")).toBeUndefined();
    expect(() => checkCommands("pnpm test && pnpm lint")).toThrow(/^CLAUDE_CODE_STYLE_CHECKS: /);
  });
});
