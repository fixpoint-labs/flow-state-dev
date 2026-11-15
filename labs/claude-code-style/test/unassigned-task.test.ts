/**
 * A code change filed with no assignee, on the lab's own host with only the
 * model scripted. The main session has several delegates, and its board's
 * dispatch claims only a task that names one, so a task filed with none would
 * sit pending with nobody to run it while the reply says it is under way.
 * `createTask` refuses it instead, and the refusal names who can take it, so
 * the turn can file it again for the coder.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { scriptedModels, waitFor } from "../../test-support/contract";
import { openLab } from "../host.mts";
import { createWiredLab, type LabAdapter, type LabTask } from "../src/adapter";

const ASK = "Rename the greeting in src/hello.ts.";

let dispose: (() => Promise<void>) | undefined;
afterEach(async () => {
  await dispose?.();
  dispose = undefined;
});

/** The lab on a fresh repository, with `desk.main` scripted to file the change with no assignee, then with the coder. */
async function bootLab(): Promise<{ lab: LabAdapter; session: string; results: string[] }> {
  const data = mkdtempSync(join(tmpdir(), "ccs-unassigned-"));
  const repo = join(data, "repo");
  const git = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, ".gitignore"), "**/.fsdev/\n");
  execFileSync("git", ["-C", repo, "add", "-A"], { env: git });
  execFileSync("git", ["-C", repo, "commit", "-q", "-m", "init"], { env: git });
  // The tool results `desk.main` was handed, one per step after its first.
  const results: string[] = [];
  const models = scriptedModels(
    {
      "agent-answer": ({ said, step }) => {
        if (!/You are main/.test(said)) return { text: "done" };
        if (step === 0) return { call: { name: "createTask", args: { title: "Rename the greeting", goal: "Rename the greeting in src/hello.ts." } } };
        results.push(said.slice(said.lastIndexOf("createTask")));
        return { text: "Filed." };
      },
      "auto-title:generate": () => ({ output: { title: "Rename" } }),
    },
    () => ({ text: "ok" }),
  ) as ModelResolver;
  const { flowState } = await openLab({ data, userId: "u_lab", model: "test/scripted", utilityModel: "test/utility", repositories: [], modelResolver: models });
  const fetcher = createInProcessFetch(flowState as never) as never;
  const client = createClient({ userId: "u_lab", baseUrl: "", fetcher });
  const lab = createWiredLab(client, { fetcher });
  dispose = async () => {
    await (flowState as unknown as { dispose?: () => Promise<void> }).dispose?.();
    rmSync(data, { recursive: true, force: true });
  };
  const project = await lab.createProject("hello", `file://${repo}`);
  const session = (await lab.openSession("session", project.id)).id;
  return { lab, session, results };
}

/** The session's tasks, read until the turn has ended. */
async function tasksAfterTurn(lab: LabAdapter, session: string, results: string[]): Promise<LabTask[]> {
  const end = Date.now() + 20_000;
  while (results.length === 0) {
    if (Date.now() > end) throw new Error("the main turn never took its createTask result");
    await waitFor(100);
  }
  const tasks = await new Promise<LabTask[]>((resolve) => {
    const stop = lab.watchTasks(session, (read) => {
      stop();
      resolve(read);
    });
  });
  if (tasks.length === 0) return tasks;
  // A task was filed: long enough for its dispatch to have claimed it, had anything claimed it.
  await waitFor(1_500);
  return new Promise((resolve) => {
    const stop = lab.watchTasks(session, (read) => {
      stop();
      resolve(read);
    });
  });
}

describe("desk.main files a code change with no assignee", () => {
  it("is refused with the delegates it can name, and nothing waits on the board unowned", async () => {
    const { lab, session, results } = await bootLab();
    await lab.send(session, ASK);
    const tasks = await tasksAfterTurn(lab, session, results);
    // Without the refusal the task is filed and sits pending, unassigned, forever.
    expect(tasks.filter((task) => task.assignee === undefined)).toEqual([]);
    expect(results[0]).toContain("assignee_required");
    expect(results[0]).toContain("desk.coder");
  }, 60_000);
});
