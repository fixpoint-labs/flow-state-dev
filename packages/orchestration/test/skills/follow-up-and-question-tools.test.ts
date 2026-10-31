/**
 * A finished task takes a follow-up (`createTask`'s `followUpOf`, FIX-1817
 * S4), and a task turn's own question tool (`holdTaskForUser`, FIX-2131) acts only
 * on the row its turn holds. How the question holds the task is pinned where
 * the gate runs for real (`task-board/settles-when-its-work-is-over.test.ts`).
 *
 * Each leg reads both the tool's answer and the row the board holds, so a
 * refusal that wrote anything anyway fails here.
 */
import { describe, expect, it } from "vitest";
import type { GeneratorTool } from "@flow-state-dev/core";
import { runForTest } from "@flow-state-dev/testing";
import {
  buildTaskToolsList,
  createHoldTaskForUser,
  taskToolsForTurn,
} from "../../src/skills/task-tools-capability";
import { createResourceBackedTaskCollection, ticketForClaim, type Task, type TaskCollectionRef } from "../../src/tasks";
import { createCapturedChanges, createFakeResourceCollection } from "../helpers";
import { BOARD_FIELD, buildDelegationCtx, ownStateResolver } from "./delegation-ctx";

function toolNamed(tools: readonly unknown[], name: string): GeneratorTool {
  const tool = tools.find((t) => (t as { config?: { name?: string } }).config?.name === name);
  if (tool === undefined) throw new Error(`tool not found: ${name}`);
  return tool as GeneratorTool;
}

const row = (id: string, patch: Partial<Task> = {}): Task =>
  ({ id, goal: `do ${id}`, status: "pending", attempts: 0, createdAt: 1, updatedAt: 1, ...patch }) as Task;

/** A board seeded with `tasks`, its tools, and a reader for its rows. */
async function board(tasks: Task[]) {
  const { ctx } = buildDelegationCtx({ self: false, preTasks: Object.fromEntries(tasks.map((t) => [t.id, t])) });
  const tools = buildTaskToolsList(ownStateResolver);
  const ref = (await ownStateResolver(ctx as never))!;
  const call = (name: string, input: unknown) => runForTest(toolNamed(tools, name), input, ctx) as Promise<any>;
  return { ctx, tools, ref, call, get: (id: string) => ref.get(id) as Task | undefined };
}

/**
 * Claim `id` on `ref` and link the run as the receiving gate does, naming this
 * turn's session and request; answers the context of that task turn: a task
 * session (its server-set `taskId`) on that request.
 */
async function claimAsGate(ref: TaskCollectionRef, id: string, base: object, requestId = "r-turn") {
  const claimed = (await ref.claim("w", { eligibility: (t) => t.id === id }))!;
  const ticket = ticketForClaim(BOARD_FIELD, claimed);
  await ref.linkRun(id, { sessionId: "s-task", requestId, attempt: claimed.attempts }, { claim: ticket });
  return turnCtx(base, requestId);
}

/** File `id` for researcher and run it to completion, as a board does: claimed, run-linked, completed. */
async function ranAndCompleted(ref: TaskCollectionRef, id: string) {
  await ref.createTask({ id, goal: `do ${id}`, assignee: "researcher" });
  const claimed = (await ref.claim("w", { eligibility: (t) => t.id === id }))!;
  const ticket = ticketForClaim(ref.collectionId, claimed, ref.partition);
  await ref.linkRun(id, { sessionId: "s-root", requestId: "r-root", attempt: claimed.attempts }, { claim: ticket });
  await ref.complete(id, "done", { claim: ticket });
}

/** `base` as a turn of the task session on request `requestId`. */
const turnCtx = (base: object, requestId: string) => ({
  ...base,
  session: { identity: { id: "s-task" }, state: { taskId: "t" } },
  request: { identity: { id: requestId } },
});

describe("createTask's followUpOf (S4)", () => {
  it("files a new row naming the finished task, with its worker (BR-20)", async () => {
    const b = await board([row("root", { status: "completed", assignee: "researcher", attempts: 1, run: { sessionId: "s-root", requestId: "r-root", attempt: 1 } })]);
    const out = await b.call("createTask", { goal: "Now open the PR", followUpOf: "root" });
    expect(out).toMatchObject({ ok: true });
    expect(out.taskId).not.toBe("root");
    expect(b.get(out.taskId)).toMatchObject({ followUpOf: "root", assignee: "researcher", status: "pending" });
    expect(b.get("root")!.status).toBe("completed");
  });

  it("resolves a follow-up of a follow-up to the first task (BR-24)", async () => {
    const b = await board([
      row("root", { status: "completed", assignee: "researcher", attempts: 1, run: { sessionId: "s-root", requestId: "r-root", attempt: 1 } }),
      row("f1", { status: "completed", assignee: "researcher", attempts: 1, followUpOf: "root" })
    ]);
    const out = await b.call("createTask", { goal: "and again", followUpOf: "f1" });
    expect(b.get(out.taskId)).toMatchObject({ followUpOf: "root", assignee: "researcher" });
  });

  it.each(["pending", "held"] as const)(
    "refuses a %s task that never ran: there is no session to follow up in, and nothing is stored (BR-21)",
    async (status) => {
      const b = await board([row("root", { status, assignee: "researcher" })]);
      const out = await b.call("createTask", { goal: "next", followUpOf: "root" });
      expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^follow_up_of_unrun: task "root" never ran/) });
      expect(b.ref.list()).toHaveLength(1);
    }
  );

  it.each(["in_progress"] as const)(
    "files a follow-up of a %s task that runs in its session: it waits for that task to end (FIX-2080)",
    async (status) => {
      const b = await board([
        row("root", { status, assignee: "researcher", attempts: 1, run: { sessionId: "s-root", requestId: "r-root", attempt: 1 } }),
      ]);
      const out = await b.call("createTask", { goal: "next", followUpOf: "root" });
      expect(out).toMatchObject({ ok: true, taskId: "root-f1" });
      expect(b.get("root-f1")).toMatchObject({ followUpOf: "root", assignee: "researcher", status: "pending" });
    }
  );

  it("refuses a follow-up of a task cancelled before it ever ran, filing nothing", async () => {
    const b = await board([row("root", { status: "cancelled", assignee: "researcher" })]);
    const out = await b.call("createTask", { goal: "next", followUpOf: "root" });
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^follow_up_of_unrun: task "root" never ran/) });
    expect(b.ref.list()).toHaveLength(1);
  });

  it("takes the lowest free number when an unrelated row already holds <root>-f1", async () => {
    const b = await board([
      row("root", { status: "completed", assignee: "researcher", attempts: 1, run: { sessionId: "s-root", requestId: "r-root", attempt: 1 } }),
      row("root-f1", { status: "pending" })
    ]);
    const out = await b.call("createTask", { goal: "next", followUpOf: "root" });
    expect(out).toMatchObject({ ok: true, taskId: "root-f2" });
    expect(b.get("root-f2")).toMatchObject({ followUpOf: "root" });
  });

  it("declines moving a pending follow-up to another worker by updateTask", async () => {
    const b = await board([
      row("root", { status: "completed", assignee: "researcher", attempts: 1, run: { sessionId: "s-root", requestId: "r-root", attempt: 1 } }),
      row("root-f1", { status: "pending", assignee: "researcher", followUpOf: "root" })
    ]);
    const out = await b.call("updateTask", { id: "root-f1", assignee: "writer" });
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^follow_up_takes_no_assignee: /) });
    expect(b.get("root-f1")!.assignee).toBe("researcher");
  });

  it("refuses an assignee beside followUpOf at input (BR-22)", async () => {
    const b = await board([row("root", { status: "completed", assignee: "researcher", attempts: 1, run: { sessionId: "s-root", requestId: "r-root", attempt: 1 } })]);
    const out = await b.call("createTask", { goal: "next", followUpOf: "root", assignee: "writer" });
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^follow_up_takes_no_assignee/) });
    expect(b.ref.list()).toHaveLength(1);
  });

  it("answers a task on no board of this caller's as not found, storing nothing (BR-23)", async () => {
    const b = await board([]);
    const out = await b.call("createTask", { goal: "next", followUpOf: "bobs-task" });
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^task_not_found/) });
    expect(b.ref.list()).toHaveLength(0);
  });

  it("accepts one of two follow-ups filed at once under one id, and asks the other to file again (BR-25, concurrent)", async () => {
    // A durable ledger: its insert takes an id once, as the stores do.
    const ref = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: createFakeResourceCollection(),
      onChange: createCapturedChanges().onChange
    });
    await ranAndCompleted(ref, "root");
    const tools = buildTaskToolsList(async () => ref);
    const { ctx } = buildDelegationCtx({ self: false });
    const file = (goal: string) => runForTest(toolNamed(tools, "createTask"), { goal, followUpOf: "root" }, ctx) as Promise<any>;
    const [one, two] = await Promise.all([file("first"), file("second")]);
    const accepted = [one, two].filter((r) => r.ok === true);
    const refused = [one, two].filter((r) => r.ok === false);
    expect(accepted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].error).toMatch(new RegExp(`^task_id_taken: .*"${accepted[0].taskId}"`));
    expect(ref.list().filter((t) => t.followUpOf === "root")).toHaveLength(1);
  });

  it("on a board that starts work, two calls whose follow-ups take one id: the second is refused, never told the other's task is its own", async () => {
    const ref = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: createFakeResourceCollection(),
      onChange: createCapturedChanges().onChange
    });
    await ranAndCompleted(ref, "root");
    const tools = taskToolsForTurn(async () => ref, undefined, { dispatches: true })({});
    const tool = tools.find((t) => (t as { name?: string }).name === "createTask")!;
    // Two model tool calls in one request, each with its own call id; the
    // request's `runOnce` memo is shared, as the request store's is. The
    // interleaving is pinned: both calls pick the follow-up's id, then c1
    // files it, then c2 records its own call.
    const memo = new Map<string, unknown>();
    let c2Picked!: () => void;
    const c2HasPicked = new Promise<void>((r) => (c2Picked = r));
    let c1Filed!: () => void;
    const c1HasFiled = new Promise<void>((r) => (c1Filed = r));
    type Gate = { before?: Promise<void>; arrived?: () => void };
    const callCtx = (callId: string, gate?: Gate) =>
      ({
        _blockIdentity: { blockName: "createTask", blockInstanceId: `req_1:root/step[0]/tool[createTask][0%3A${callId}]:0` },
        session: { identity: { type: "session", id: "s_1", userId: "alice" }, state: {} },
        request: { identity: { type: "request", id: "req_1" } },
        runOnce: async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
          // The gate holds the record of the call's id, after its checks.
          if (key.startsWith("fsd.dispatch.plan:")) {
            gate?.arrived?.();
            await gate?.before;
          }
          if (memo.has(key)) return memo.get(key) as T;
          const value = await fn();
          memo.set(key, value);
          return value;
        }
      }) as never;
    const file = (goal: string, callId: string, gate?: Gate) =>
      runForTest(tool as never, { goal, followUpOf: "root" } as never, callCtx(callId, gate)) as Promise<any>;
    const [one, two] = await Promise.all([
      file("first", "c1", { before: c2HasPicked }).finally(() => c1Filed()),
      file("second", "c2", { arrived: () => c2Picked(), before: c1HasFiled })
    ]);
    const accepted = [one, two].filter((r) => r.ok === true);
    const refused = [one, two].filter((r) => r.ok === false);
    expect(accepted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].error).toMatch(new RegExp(`^task_id_taken: .*"${accepted[0].taskId}"`));
    const followUps = ref.list().filter((t) => t.followUpOf === "root");
    expect(followUps).toHaveLength(1);
    // The accepted call's goal is the one on the row.
    expect(followUps[0]!.goal).toBe(accepted[0] === one ? "first" : "second");
    // A replay of the accepted call finds its own row and files nothing more.
    const acceptedCall = accepted[0] === one ? ["first", "c1"] : ["second", "c2"];
    expect(await file(acceptedCall[0]!, acceptedCall[1]!)).toMatchObject({ ok: true, taskId: accepted[0].taskId });
    // A replay of the refused call finds the id it recorded taken by the other
    // call's row, and is refused again: never told that row is its own.
    const refusedCall = accepted[0] === one ? ["second", "c2"] : ["first", "c1"];
    expect(await file(refusedCall[0]!, refusedCall[1]!)).toMatchObject({
      ok: false,
      error: expect.stringMatching(new RegExp(`^task_id_taken: .*"${accepted[0].taskId}"`))
    });
    expect(ref.list().filter((t) => t.followUpOf === "root")).toHaveLength(1);
    // The row names the call that filed it, and a caller can't write that.
    expect(ref.get(accepted[0].taskId)!.metadata?.filedByCall).toEqual(expect.stringContaining(`0%3A${acceptedCall[1]}`));
  });

  it("keeps the call a follow-up names out of updateTask's reach: a metadata patch naming another call leaves it as it was", async () => {
    const ref = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: createFakeResourceCollection(),
      onChange: createCapturedChanges().onChange
    });
    await ranAndCompleted(ref, "root");
    const tools = taskToolsForTurn(async () => ref, undefined, { dispatches: true })({});
    const tool = (name: string) => tools.find((t) => (t as { name?: string }).name === name)!;
    const memo = new Map<string, unknown>();
    const ctx = {
      _blockIdentity: { blockName: "createTask", blockInstanceId: "req_1:root/step[0]/tool[createTask][0%3Ac1]:0" },
      session: { identity: { type: "session", id: "s_1", userId: "alice" }, state: {} },
      request: { identity: { type: "request", id: "req_1" } },
      runOnce: async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
        if (!memo.has(key)) memo.set(key, await fn());
        return memo.get(key) as T;
      }
    } as never;
    const filed = (await runForTest(tool("createTask") as never, { goal: "next", followUpOf: "root" } as never, ctx)) as { ok: boolean; taskId: string };
    expect(filed).toMatchObject({ ok: true });
    const marker = ref.get(filed.taskId)!.metadata?.filedByCall;
    expect(marker).toEqual(expect.stringContaining("0%3Ac1"));
    const patched = (await runForTest(tool("updateTask") as never, { id: filed.taskId, metadata: { filedByCall: "x", note: "kept" } } as never, ctx)) as { ok: boolean };
    expect(patched).toMatchObject({ ok: true });
    expect(ref.get(filed.taskId)!.metadata).toMatchObject({ filedByCall: marker, note: "kept" });
  });

  it("files a follow-up while the session has an unfinished task: it waits, never refused (FIX-2080)", async () => {
    const b = await board([
      row("root", { status: "completed", assignee: "researcher", attempts: 1, run: { sessionId: "s-root", requestId: "r-root", attempt: 1 } }),
      row("f1", { status: "in_progress", assignee: "researcher", attempts: 1, followUpOf: "root" })
    ]);
    const out = await b.call("createTask", { goal: "more", followUpOf: "root" });
    expect(out).toMatchObject({ ok: true, taskId: "root-f1" });
    expect(b.get("root-f1")).toMatchObject({ followUpOf: "root", status: "pending" });
    expect(b.ref.list()).toHaveLength(3);
  });
});

describe("holdTaskForUser off a task turn (FIX-2131)", () => {
  const ask = createHoldTaskForUser({ resolve: (ctx) => ownStateResolver(ctx) });

  it("is not offered, and reaches nothing, on a person's turn in the task session (another request)", async () => {
    const b = await board([row("t", { assignee: "w" })]);
    await claimAsGate(b.ref, "t", b.ctx);
    const person = turnCtx(b.ctx, "r-person");
    expect(await ask.offered(person as never)).toBe(false);
    // A task id on input is not an input the tool reads.
    const out = (await runForTest(ask.tool, { question: "Which?", taskId: "t" } as never, person as never)) as any;
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^not_a_task_turn/) });
    expect(b.get("t")!.status).toBe("in_progress");
    expect(b.get("t")!.holds ?? []).toEqual([]);
  });

  it("is not offered outside a task session at all", async () => {
    const b = await board([row("t", { assignee: "w" })]);
    expect(await ask.offered(b.ctx as never)).toBe(false);
  });

  it("is offered on a task turn working a running row, a waited-on one included", async () => {
    const b = await board([row("t", { assignee: "w", wait: { gateId: "g", deadline: 9e12 } })]);
    const turn = await claimAsGate(b.ref, "t", b.ctx);
    expect(await ask.offered(turn as never)).toBe(true);
  });
});
