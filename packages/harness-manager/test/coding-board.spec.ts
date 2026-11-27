// FIX-2725 D2.
/**
 * The coding board view: a conversation's coding board, served at user scope
 * on the harness kit's `harnesses` flow, read through the router as a client
 * reads it.
 *
 * Why it matters: a screen draws a conversation's coding tasks from this one
 * answer, with no action run in another session and no read per card. Each
 * task's harness is its worker's `harness:` setting until its run reports
 * one; a failed task carries why; another user's conversation answers
 * nothing; and the board is heard on the conversation's board notices, an
 * empty board included, so the first task filed reaches the screen.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { observedPullRequestsCollection, planKeySegment } from "@flow-state-dev/core/harness";
import { declaredIndexes } from "@flow-state-dev/core/types";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { workforce } from "@flow-state-dev/workforce/kit";
import type { Harness } from "@flow-state-dev/core/harness";
import { scriptedHarness } from "../src/scripted-harness";
import { harnesses } from "../src/kit";
import { HarnessRunChangesRefused } from "../src/run-changes";

const states: FlowState[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const state of states.splice(0)) await state.dispose().catch(() => undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const worker = (name: string, extra: string) => `---\nname: ${name}\ndescription: ${name}.\n${extra}---\nYou are ${name}.`;

function team(): string {
  const dir = mkdtempSync(join(tmpdir(), "fsd-coding-board-"));
  dirs.push(dir);
  const files = {
    "teams/core/workers/lead/WORKER.md": worker("Lead", "delegates:\n  - core.codex\n"),
    "teams/core/workers/codex/WORKER.md": worker("Codex", "flow: coder\nharness: codex\n"),
  };
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), body);
  }
  return dir;
}

const harness: Harness = { id: "codex", label: "Codex", agent: scriptedHarness({ stepEveryMs: 1 }).slot, readiness: async () => ({ ready: true }), pass: [] };
const workspace = localWorkspaceHost({ root: join(tmpdir(), "fsd-coding-board-runs"), remotes: { allow: [] }, source: () => ({ kind: "repo", repo: tmpdir() }) });

async function boot() {
  const state = createFlowState({
    kits: [harnesses({ workspace }), workforce({ directory: team() })],
    fill: { [harnesses.slots.harnesses]: [harness] },
    stores: { default: { primary: inMemoryStores() } },
  });
  states.push(state);
  await state.ready();
  const router = await state.getRouter();
  const post = async (path: string[], body: unknown) => {
    const res = await router.POST(
      new Request(`http://localhost/api/flows/${path.join("/")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      { params: { path } },
    );
    return { status: res.status, body: (await res.json()) as any };
  };
  const board = async (userId: string, sessionId: string) => {
    const answer = await post(["harnesses", "views", "codingBoard"], { userId, input: { sessionId } });
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return answer.body as { output: any[]; hears: Array<{ topic: Record<string, unknown>; kinds: string[] }> };
  };
  const stores = (await state.getRuntime()).stores;
  return { post, board, stores };
}

describe("the recorded work view", () => {
  it("answers a run's pull requests, read in its own session, and none of another run's", async () => {
    const { post, stores } = await boot();
    const created = await post(["coder", "sessions"], { userId: "alice", state: { workerId: "core.codex" } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const session = created.body.session.id as string;
    const opened = (requestId: string, number: number) => ({ url: `https://example.test/pr/${number}`, number, title: `PR ${number}`, requestId, firstSeenAt: number, host: null, repository: null, state: null, branch: null, source: "tool" });
    await stores.resourceState.set("session", session, "observed-pull-requests/a", opened("req_1", 7) as never, "any");
    await stores.resourceState.set("session", session, "observed-pull-requests/b", opened("req_2", 9) as never, "any");
    const answer = await post(["coder", session, "views", "recordedWork"], { userId: "alice", input: { requestId: "req_1" } });
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body.output).toEqual({ plan: null, pullRequests: { rows: [{ number: 7, url: "https://example.test/pr/7", title: "PR 7" }], truncated: false } });
  });

  it("answers a run's pull requests in a session whose earlier runs opened more than the cap", async () => {
    const { post, stores } = await boot();
    const created = await post(["coder", "sessions"], { userId: "alice", state: { workerId: "core.codex" } });
    const session = created.body.session.id as string;
    const opened = (requestId: string, number: number) => ({ url: `https://example.test/pr/${number}`, number, title: `PR ${number}`, requestId, firstSeenAt: number, host: null, repository: null, state: null, branch: null, source: "tool" });
    // Earlier runs' records come first in the listing and fill the cap.
    for (let n = 0; n < 205; n++) {
      await stores.resourceState.set("session", session, `observed-pull-requests/a${String(n).padStart(3, "0")}`, opened("req_old", n) as never, "any");
    }
    await stores.resourceState.set("session", session, "observed-pull-requests/z", opened("req_new", 999) as never, "any");
    const answer = await post(["coder", session, "views", "recordedWork"], { userId: "alice", input: { requestId: "req_new" } });
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body.output.pullRequests).toEqual({ rows: [{ number: 999, url: "https://example.test/pr/999", title: "PR 999" }], truncated: false });
    // The run's rows are found by the run, not by listing every run's: the collection declares the index.
    expect(declaredIndexes(observedPullRequestsCollection as never).map((index) => index.name)).toEqual(["requestId"]);
  });
});

describe("the run changes view", () => {
  it("is served on the coding worker flow, in a run's own session, so a review can open a file's patch", async () => {
    const { post } = await boot();
    const created = await post(["coder", "sessions"], { userId: "alice", state: { workerId: "core.codex" } });
    const session = created.body.session.id as string;
    // A session that ran no task has no changes: refused by the view, not a missing route.
    const answer = await post(["coder", session, "views", "changes"], { userId: "alice", input: { path: "a.ts" } });
    expect(answer.status, JSON.stringify(answer.body)).toBe(422);
    expect(answer.body.message).toBe(new HarnessRunChangesRefused("not-started").message);
  });
});

describe("the recorded work view, past its cap", () => {
  it("says a plan and a run's pull requests were cut at 200, so a screen never shows a partial answer as whole", async () => {
    const { post, stores } = await boot();
    const created = await post(["coder", "sessions"], { userId: "alice", state: { workerId: "core.codex" } });
    const session = created.body.session.id as string;
    const segment = planKeySegment("req_big");
    for (let n = 0; n < 201; n++) {
      const at = String(n).padStart(3, "0");
      await stores.resourceState.set("session", session, `observed-plan/${segment}/inv/${at}`, { title: `Step ${at}`, status: "pending" } as never, "any");
      await stores.resourceState.set("session", session, `observed-pull-requests/p${at}`, { url: `https://example.test/pr/${n}`, number: n, title: null, requestId: "req_big", firstSeenAt: n, host: null, repository: null, state: null, branch: null, source: "tool" } as never, "any");
    }
    const answer = await post(["coder", session, "views", "recordedWork"], { userId: "alice", input: { requestId: "req_big" } });
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body.output.plan.rows).toHaveLength(200);
    expect(answer.body.output.plan.truncated).toBe(true);
    expect(answer.body.output.pullRequests.rows).toHaveLength(200);
    expect(answer.body.output.pullRequests.truncated).toBe(true);
  });
});

describe("the coding board view", () => {
  it("answers a conversation's coding tasks with the worker's harness, and nothing of another user's", async () => {
    const { post, board, stores } = await boot();
    const created = await post(["agent", "sessions"], { userId: "alice", state: { workerId: "core.lead" } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const conversation = created.body.session.id as string;

    // Empty, and heard on the conversation's board notices.
    const empty = await board("alice", conversation);
    expect(empty.output).toEqual([]);
    expect(empty.hears).toContainEqual({ topic: { scope: "session", id: conversation, resource: "tasks" }, kinds: ["board"] });

    const filed = await post(["agent", conversation, "actions", "createTask_tasks"], { userId: "alice", input: { goal: "Fix the build", assignee: "core.codex", held: true } });
    expect(filed.status, JSON.stringify(filed.body)).toBe(202);
    for (let i = 0; i < 100 && (await stores.request.get(filed.body.request.id))?.status === "in_progress"; i += 1) await new Promise((r) => setTimeout(r, 10));

    const [task] = (await board("alice", conversation)).output;
    expect(task).toMatchObject({ goal: "Fix the build", assignee: "core.codex", harness: "codex", review: null, landed: null, error: null, pullRequests: [], asks: [], runFlow: null });

    // Bob asking for alice's conversation: nothing, and no topic of hers.
    const bobs = await board("bob", conversation);
    expect(bobs.output).toEqual([]);
    expect(bobs.hears.map((hearing) => hearing.topic)).not.toContainEqual(expect.objectContaining({ id: conversation }));

    // A past run that reported another harness shows that harness, and its review, whatever the
    // worker's setting is now and whether the worker is still on the roster.
    const userKey = `alice:~org:${DEFAULT_ORG_ID}`;
    const stored = await stores.resourceState.getByPrefix("user", userKey, "tasks/");
    const [key, record] = Object.entries(stored).find(([, value]) => (value.state as { id?: string }).id === task.id)!;
    const ranOn = (harness: string) => ({ requests: [{ requestId: "req_past", settled: [], live: null, harness, harnessModel: null, model: null, writer: "w1", admittedAt: 1, recovered: null }] });
    await stores.resourceState.set("user", userKey, key, { ...(record.state as object), status: "completed", output: { review: "accepted" }, spend: ranOn("claude") } as never, "any");
    const [past] = (await board("alice", conversation)).output;
    expect(past).toMatchObject({ harness: "claude", review: "accepted" });
    await stores.resourceState.set("user", userKey, key, { ...(record.state as object), assignee: "core.gone", status: "completed", output: { review: "deadline" }, spend: ranOn("claude") } as never, "any");
    const [gone] = (await board("alice", conversation)).output;
    expect(gone).toMatchObject({ harness: "claude", review: "deadline" });

    // A task with a run names the flow its run's session runs on, so a screen reads that run's own
    // stream without looking the session up; a run whose session is gone names none.
    const runIn = (sessionId: string) => ({ ...(record.state as object), status: "in_progress", run: { sessionId, requestId: "req_now", attempt: 1 } });
    await stores.resourceState.set("user", userKey, key, runIn(conversation) as never, "any");
    expect((await board("alice", conversation)).output[0]).toMatchObject({ runFlow: "agent" });
    await stores.resourceState.set("user", userKey, key, runIn("sess_gone") as never, "any");
    expect((await board("alice", conversation)).output[0]).toMatchObject({ runFlow: null });
  });
});

describe("the coding board view, for one open task", () => {
  /** A conversation with `goals` filed on its board, and its entries as stored. */
  async function filed(goals: string[]) {
    const { post, stores } = await boot();
    const created = await post(["agent", "sessions"], { userId: "alice", state: { workerId: "core.lead" } });
    const conversation = created.body.session.id as string;
    for (const goal of goals) {
      const filing = await post(["agent", conversation, "actions", "createTask_tasks"], { userId: "alice", input: { goal, assignee: "core.codex", held: true } });
      expect(filing.status, JSON.stringify(filing.body)).toBe(202);
      for (let i = 0; i < 100 && (await stores.request.get(filing.body.request.id))?.status === "in_progress"; i += 1) await new Promise((r) => setTimeout(r, 10));
    }
    const userKey = `alice:~org:${DEFAULT_ORG_ID}`;
    const entries = Object.entries(await stores.resourceState.getByPrefix("user", userKey, "tasks/")).map(([key, record]) => ({ key, entry: record.state as { id: string } }));
    const write = (key: string, entry: object) => stores.resourceState.set("user", userKey, key, entry as never, "any");
    const read = async (input: Record<string, unknown> = {}) => {
      const answer = await post(["harnesses", "views", "codingBoard"], { userId: "alice", input: { sessionId: conversation, ...input } });
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      return answer.body.output as Array<{ id: string; status: string; error: string | null; detail: unknown }>;
    };
    return { entries, write, read };
  }

  it("carries the answer of the task its input names, cut as getTask cuts it, and on no other entry or read", async () => {
    const { entries, write, read } = await filed(["Fix the build", "Write the notes"]);
    const [long, short] = entries;
    // One answer past getTask's cut, one a coding run's `answer` under it.
    const text = "a".repeat(20_005);
    await write(long!.key, { ...long!.entry, status: "completed", output: text });
    await write(short!.key, { ...short!.entry, status: "completed", output: { answer: "Fixed: the lockfile was stale." } });

    // The board read carries no answer: every entry's detail is null.
    expect((await read()).map((entry) => entry.detail)).toEqual([null, null]);
    // Named, every entry still comes back, and only the named one carries its answer.
    const longRead = await read({ taskId: long!.entry.id });
    expect(longRead).toHaveLength(2);
    expect(longRead.find((entry) => entry.id === long!.entry.id)!.detail).toEqual({ answer: text.slice(0, 20_000), answerCut: true });
    expect(longRead.find((entry) => entry.id === short!.entry.id)!.detail).toBeNull();
    const shortRead = await read({ taskId: short!.entry.id });
    expect(shortRead.find((entry) => entry.id === short!.entry.id)!.detail).toEqual({ answer: "Fixed: the lockfile was stale.", answerCut: false });
    expect(shortRead.find((entry) => entry.id === long!.entry.id)!.detail).toBeNull();
  });

  it("carries no answer while a retried task runs again: the output it kept is its last attempt's", async () => {
    const { entries, write, read } = await filed(["Fix the build"]);
    const [{ key, entry }] = entries as [(typeof entries)[number]];
    // Answered once, then failed and retried: the board keeps the earlier output on the entry.
    await write(key, { ...entry, status: "in_progress", attempts: 2, output: { answer: "The first attempt's answer." } });
    expect((await read({ taskId: entry.id }))[0]!.detail).toEqual({ answer: null, answerCut: false });
    await write(key, { ...entry, status: "completed", attempts: 2, output: { answer: "The second attempt's answer." } });
    expect((await read({ taskId: entry.id }))[0]!.detail).toEqual({ answer: "The second attempt's answer.", answerCut: false });
  });

  it("gives each task its title and the state the user sees it in, from one taskView of the row with its asks", async () => {
    const { entries, write, read } = await filed(["Fix the build"]);
    const [{ key, entry }] = entries as [(typeof entries)[number]];
    type Seen = { title: string; state: string; asks: unknown[] };
    const seen = async () => (await read())[0] as unknown as Seen;
    // Filed with no title: the screen's words are its goal. Filed held: it isn't queued.
    expect(await seen()).toMatchObject({ title: "Fix the build", state: "held" });
    // Its own title wins over the goal.
    await write(key, { ...entry, title: "Build fix", status: "pending" });
    expect(await seen()).toMatchObject({ title: "Build fix", state: "queued" });
    // A question for you on a running task: it waits on you, and its ask says so.
    const question = { id: "q1", actor: "user", openedAt: 1, source: { kind: "task", closedBy: [{ by: "answer" }] }, ask: { kind: "question", prompt: "EU or US?" } };
    await write(key, { ...entry, status: "in_progress", holds: [question] });
    const waiting = await seen();
    expect(waiting.state).toBe("waiting");
    expect(waiting.asks).toHaveLength(1);
    // Nothing waits on you: running. Ended: done, whatever hold it kept.
    await write(key, { ...entry, status: "in_progress", holds: [] });
    expect((await seen()).state).toBe("running");
    await write(key, { ...entry, status: "completed", holds: [question] });
    expect((await seen()).state).toBe("done");
  });

  it("names the reason a cancelled task was cancelled with, as it names why a failed one failed", async () => {
    const { entries, write, read } = await filed(["Fix the build"]);
    const [{ key, entry }] = entries as [(typeof entries)[number]];
    await write(key, { ...entry, status: "cancelled", error: "Not needed any more" });
    expect((await read())[0]).toMatchObject({ status: "cancelled", error: "Not needed any more" });
    // A completed task's stale error is still none.
    await write(key, { ...entry, status: "completed", error: "a stale error" });
    expect((await read())[0]).toMatchObject({ status: "completed", error: null });
  });
});
