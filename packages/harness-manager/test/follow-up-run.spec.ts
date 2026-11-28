/**
 * A follow-up of a finished coding task, through the harness kit's coder as a
 * conversation files it and you talk to it.
 *
 * Why it matters: a follow-up is "now also handle X" on work its root already
 * did. It must continue the root's run: the root's checkout and branch, with
 * the root's commits in place, and the root's coding session. And the coder's
 * session door must find that same run afterwards, so a line typed in the
 * session resumes the session the follow-up left, not "no session to continue".
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { workforce } from "@flow-state-dev/workforce/kit";
import type { Harness } from "@flow-state-dev/core/harness";
import { harnessStub } from "../src/harness-stub";
import { harnesses } from "../src/kit";
import { seedRepo } from "./fixtures";

const states: FlowState[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const state of states.splice(0)) await state.dispose().catch(() => undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const worker = (name: string, extra: string) => `---\nname: ${name}\ndescription: ${name}.\n${extra}---\nYou are ${name}.`;

function team(root: string): string {
  const dir = join(root, "team");
  const files = {
    "teams/core/workers/lead/WORKER.md": worker("Lead", "delegates:\n  - core.coder\n"),
    "teams/core/workers/coder/WORKER.md": worker("Coder", "flow: coder\nharness: stub\n"),
  };
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), body);
  }
  return dir;
}

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

async function boot() {
  const root = mkdtempSync(join(tmpdir(), "fsd-follow-up-run-"));
  dirs.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  seedRepo(repo);
  // Each run commits a file of its own, and notes the log it worked on.
  const logs: string[] = [];
  const stub = harnessStub({
    finalMessage: "done",
    duringRun: (run) => {
      logs.push(git(run.cwd, "log", "--format=%s"));
      writeFileSync(join(run.cwd, `${run.session}.txt`), `${run.session}\n`);
      git(run.cwd, "add", `${run.session}.txt`);
      git(run.cwd, "-c", "user.email=stub@example.test", "-c", "user.name=Stub", "commit", "-q", "-m", `work of ${run.session}`);
    },
  });
  const harness: Harness = { id: "stub", label: "Stub", agent: stub.slot, readiness: async () => ({ ready: true }), pass: [] };
  const workspace = localWorkspaceHost({ root: join(root, "runs"), remotes: { allow: ["file"] }, source: () => ({ kind: "repo", repo: `file://${repo}` }) });
  const state = createFlowState({
    kits: [harnesses({ workspace, judge: false }), workforce({ directory: team(root) })],
    fill: { [harnesses.slots.harnesses]: [harness] },
    stores: { default: { primary: inMemoryStores() } },
  });
  states.push(state);
  await state.ready();
  const router = await state.getRouter();
  const stores = (await state.getRuntime()).stores;
  const post = async (path: string[], body: unknown) => {
    const res = await router.POST(
      new Request(`http://localhost/api/flows/${path.join("/")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      { params: { path } },
    );
    return { status: res.status, body: (await res.json()) as any };
  };
  /** Send an action and answer its request once it has ended. */
  const send = async (path: string[], input: Record<string, unknown>) => {
    const sent = await post(path, { userId: "alice", input });
    expect(sent.status, JSON.stringify(sent.body)).toBe(202);
    for (let n = 0; n < 300 && (await stores.request.get(sent.body.request.id))?.status === "in_progress"; n++) await new Promise((r) => setTimeout(r, 10));
    return (await stores.request.get(sent.body.request.id))!;
  };
  const created = await post(["agent", "sessions"], { userId: "alice", state: { workerId: "core.lead" } });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const conversation = created.body.session.id as string;
  const userKey = `alice:~org:${DEFAULT_ORG_ID}`;
  const stored = async (taskId: string) => {
    const entries = await stores.resourceState.getByPrefix("user", userKey, "tasks/");
    return Object.values(entries).map((entry) => entry.state as Record<string, any>).find((task) => task.id === taskId)!;
  };
  /** File a task in the conversation, and answer its stored task once it has ended. */
  const fileAndSettle = async (input: Record<string, unknown>) => {
    const filed = (await send(["agent", conversation, "actions", "createTask_tasks"], input)).result?.output as { ok: boolean; taskId?: string; task?: { id: string } };
    expect(filed.ok, JSON.stringify(filed)).toBe(true);
    const id = filed.taskId ?? filed.task!.id;
    let task = await stored(id);
    for (let n = 0; n < 500 && !["completed", "errored", "failed", "cancelled"].includes(task.status); n++) {
      await new Promise((r) => setTimeout(r, 20));
      task = await stored(id);
    }
    return task;
  };
  return { stub, logs, send, fileAndSettle };
}

describe("a follow-up of a finished coding task, on the harness kit's coder", () => {
  it("continues the root's checkout, branch and coding session, and the session door talks in it afterwards", async () => {
    const { stub, logs, send, fileAndSettle } = await boot();

    const root = await fileAndSettle({ goal: "Add the export", assignee: "core.coder" });
    expect(root.status, JSON.stringify(root)).toBe("completed");
    const followUp = await fileAndSettle({ goal: "Now also skip archived records", followUpOf: root.id });
    expect(followUp.status, JSON.stringify(followUp)).toBe("completed");
    expect(followUp.followUpOf).toBe(root.id);

    const [first, second] = stub.runs;
    expect(stub.runs).toHaveLength(2);
    // The root's checkout, on the root's branch, with the root's commit in place.
    expect(second!.cwd).toBe(first!.cwd);
    expect(logs[1]).toContain(`work of ${first!.session}`);
    expect(git(second!.cwd, "log", "--format=%s")).toContain(`work of ${second!.session}`);
    // The root's coding session, resumed.
    expect(second!.resume).toBe(first!.session);

    // A line typed in the session, every task finished, is talk in the session the follow-up left.
    const talked = await send(["coder", followUp.run.sessionId, "actions", "respond"], { message: "What did you change?" });
    expect(talked.status, JSON.stringify(talked.result ?? talked)).toBe("completed");
    expect(stub.runs).toHaveLength(3);
    expect(stub.runs[2]).toMatchObject({ prompt: "What did you change?", resume: second!.session, cwd: first!.cwd });
  }, 60_000);
});
