/**
 * The question path's task tools (FIX-1817 S1, S2, S4): a task turn parks its
 * own row on a question (`parkOnQuestion`), whoever may write the board answers
 * it (`answerTask`), and a finished task takes a follow-up (`addTask`'s
 * `followUpOf`).
 *
 * Each leg reads both the tool's answer and the row the board holds, so a
 * refusal that wrote anything anyway fails here.
 */
import { describe, expect, it } from "vitest";
import type { GeneratorTool } from "@flow-state-dev/core";
import { runForTest } from "@flow-state-dev/testing";
import {
  buildTaskToolsList,
  createParkOnQuestion,
  defaultOwnStateResolver,
  taskToolsForTurn,
  DELEGATION_BOARD_FIELD,
} from "../../src/skills/task-tools-capability";
import { createResourceBackedTaskCollection, ticketForClaim, type Task, type TaskCollectionRef } from "../../src/tasks";
import { createCapturedChanges, createFakeResourceCollection } from "../helpers";
import { buildDelegationCtx } from "./delegation-ctx";

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
  const tools = buildTaskToolsList(defaultOwnStateResolver);
  const ref = (await defaultOwnStateResolver(ctx as never))!;
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
  const ticket = ticketForClaim(DELEGATION_BOARD_FIELD, claimed);
  await ref.linkRun(id, { sessionId: "s-task", requestId, attempt: claimed.attempts }, { claim: ticket });
  return turnCtx(base, requestId);
}

/**
 * `answerTask` as a caller whose pre-read saw `asOf`: the tool runs with a
 * board whose `get` answers that row, so its write is the late one.
 */
async function answerAsOf(b: Awaited<ReturnType<typeof board>>, asOf: Task, answer: string) {
  const stale = { ...b.ref, get: (id: string) => (id === asOf.id ? asOf : b.ref.get(id)) } as TaskCollectionRef;
  const tools = buildTaskToolsList(async () => stale);
  return runForTest(toolNamed(tools, "answerTask"), { taskId: asOf.id, answer }, b.ctx) as Promise<any>;
}

/** File `id` for researcher and run it to completion, as a board does: claimed, run-linked, completed. */
async function ranAndCompleted(ref: TaskCollectionRef, id: string) {
  await ref.addTask({ id, goal: `do ${id}`, assignee: "researcher" });
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

describe("answerTask (S2)", () => {
  it("is one of the task tools, beside the eight", () => {
    const names = buildTaskToolsList(defaultOwnStateResolver).map((t) => (t as any).config.name);
    expect(names.filter((n: string) => n === "answerTask")).toHaveLength(1);
    expect(names).toHaveLength(9);
  });

  it("re-queues a task parked on a question with the answer, counted as a re-entry (BR-6, BR-8)", async () => {
    const b = await board([row("t", { status: "parked", parkedOnQuestion: true, feedback: "Which region?", attempts: 1, maxAttempts: 1 })]);
    expect(await b.call("answerTask", { taskId: "t", answer: "eu-west" })).toEqual({ ok: true });
    expect(b.get("t")).toMatchObject({ status: "pending", feedback: "eu-west", answered: true, turnReentries: 1 });
  });

  it("declines a second answer, naming the status, and re-queues nothing (BR-9)", async () => {
    const b = await board([row("t", { status: "parked", parkedOnQuestion: true, feedback: "Which region?", attempts: 1 })]);
    await b.call("answerTask", { taskId: "t", answer: "eu-west" });
    const second = await b.call("answerTask", { taskId: "t", answer: "us-east" });
    expect(second).toMatchObject({ ok: false, error: expect.stringMatching(/^not_parked_on_question: .*pending/) });
    expect(b.get("t")).toMatchObject({ feedback: "eu-west", turnReentries: 1 });
  });

  it.each([
    ["pending", {}],
    ["in_progress", { attempts: 1 }],
    ["blocked", {}]
  ] as const)("declines a %s task, naming why, and writes nothing (BR-10)", async (status, extra) => {
    const b = await board([row("t", { status, ...extra })]);
    const before = JSON.stringify(b.get("t"));
    const out = await b.call("answerTask", { taskId: "t", answer: "eu-west" });
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(new RegExp(`^not_parked_on_question: .*${status}`)) });
    expect(JSON.stringify(b.get("t"))).toBe(before);
  });

  it("declines a task parked for a person's turn: that park re-enters through its own door (BR-10)", async () => {
    const b = await board([row("t", { status: "parked", parkedForTurn: true, attempts: 1 })]);
    const out = await b.call("answerTask", { taskId: "t", answer: "eu-west" });
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^not_parked_on_question: .*person's turn/) });
    expect(b.get("t")).toMatchObject({ status: "parked", parkedForTurn: true });
  });

  it.each(["completed", "errored", "cancelled"] as const)(
    "declines a %s task as terminal_task_write_declined (BR-9, BR-26)",
    async (status) => {
      const b = await board([row("t", { status, attempts: 1 })]);
      const out = await b.call("answerTask", { taskId: "t", answer: "eu-west" });
      expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^terminal_task_write_declined: task "t" is/) });
      expect(b.get("t")!.status).toBe(status);
    }
  );

  it("declines a quiet park, such as a task waiting on its pieces, as not_parked_on_question, writing nothing", async () => {
    const b = await board([row("t", { assignee: "w" })]);
    const claimed = (await b.ref.claim("w"))!;
    await b.ref.awaitReview("t", undefined, { claim: ticketForClaim(DELEGATION_BOARD_FIELD, claimed), quiet: true });
    const before = JSON.stringify(b.get("t"));
    const out = await b.call("answerTask", { taskId: "t", answer: "eu-west" });
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^not_parked_on_question: /) });
    expect(JSON.stringify(b.get("t"))).toBe(before);
  });

  it("refuses a stale answer that arrives after the task re-parked on a newer question, leaving that question parked", async () => {
    const park = createParkOnQuestion({ resolve: (ctx) => defaultOwnStateResolver(ctx) });
    const b = await board([row("t", { assignee: "w", maxAttempts: 3 })]);
    const first = await claimAsGate(b.ref, "t", b.ctx);
    await runForTest(park.tool, { question: "Which region?" }, first as never);
    // Two answers to "Which region?" leave together; the first lands.
    const stale = b.get("t")!;
    expect(await b.call("answerTask", { taskId: "t", answer: "eu-west" })).toEqual({ ok: true });
    // The task runs again and parks on a newer question.
    const second = await claimAsGate(b.ref, "t", b.ctx, "r-turn-2");
    await runForTest(park.tool, { question: "Which account?" }, second as never);
    expect(b.get("t")).toMatchObject({ status: "parked", feedback: "Which account?" });
    expect(b.get("t")!.attempts).toBeGreaterThan(stale.attempts);
    // The late answer to the first question, read against the row as it stood then.
    const late = await answerAsOf(b, stale, "us-east");
    expect(late).toMatchObject({ ok: false, error: expect.stringMatching(/^not_parked_on_question: /) });
    expect(b.get("t")).toMatchObject({ status: "parked", feedback: "Which account?" });
  });

  it("still declines a reassign when the answer lands between the tool's read and its write", async () => {
    const b = await board([row("t", { status: "parked", parkedOnQuestion: true, feedback: "Which region?", attempts: 1, assignee: "researcher" })]);
    // The tool reads the row before the answer...
    const before = b.get("t")!;
    expect(await b.call("answerTask", { taskId: "t", answer: "eu-west" })).toEqual({ ok: true });
    // ...and writes after it: the write itself must refuse.
    const stale = { ...b.ref, get: (id: string) => (id === "t" ? before : b.ref.get(id)) } as TaskCollectionRef;
    const tools = buildTaskToolsList(async () => stale);
    const out = (await runForTest(toolNamed(tools, "assignTask"), { taskId: "t", assignee: "writer" }, b.ctx)) as any;
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^task_awaiting_answer: /) });
    expect(b.get("t")!.assignee).toBe("researcher");
  });

  it("answers an unknown task as not found: another board's rows are unknown here (BR-11)", async () => {
    const b = await board([]);
    expect(await b.call("answerTask", { taskId: "elsewhere", answer: "x" })).toEqual({
      ok: false,
      error: "task_not_found",
      taskId: "elsewhere"
    });
  });
});

describe("addTask's followUpOf (S4)", () => {
  it("files a new row naming the finished task, with its worker (BR-20)", async () => {
    const b = await board([row("root", { status: "completed", assignee: "researcher", attempts: 1, run: { sessionId: "s-root", requestId: "r-root", attempt: 1 } })]);
    const out = await b.call("addTask", { goal: "Now open the PR", followUpOf: "root" });
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
    const out = await b.call("addTask", { goal: "and again", followUpOf: "f1" });
    expect(b.get(out.taskId)).toMatchObject({ followUpOf: "root", assignee: "researcher" });
  });

  it.each(["pending", "in_progress", "parked", "blocked"] as const)(
    "refuses a %s task, naming its status, and stores nothing (BR-21)",
    async (status) => {
      const b = await board([row("root", { status, assignee: "researcher" })]);
      const out = await b.call("addTask", { goal: "next", followUpOf: "root" });
      expect(out).toMatchObject({ ok: false, error: expect.stringMatching(new RegExp(`^follow_up_of_unfinished: .*${status}`)) });
      expect(b.ref.list()).toHaveLength(1);
    }
  );

  it("refuses a follow-up of a task cancelled before it ever ran, filing nothing", async () => {
    const b = await board([row("root", { status: "cancelled", assignee: "researcher" })]);
    const out = await b.call("addTask", { goal: "next", followUpOf: "root" });
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^follow_up_of_unfinished: task "root" never ran/) });
    expect(b.ref.list()).toHaveLength(1);
  });

  it("takes the lowest free number when an unrelated row already holds <root>-f1", async () => {
    const b = await board([
      row("root", { status: "completed", assignee: "researcher", attempts: 1, run: { sessionId: "s-root", requestId: "r-root", attempt: 1 } }),
      row("root-f1", { status: "pending" })
    ]);
    const out = await b.call("addTask", { goal: "next", followUpOf: "root" });
    expect(out).toMatchObject({ ok: true, taskId: "root-f2" });
    expect(b.get("root-f2")).toMatchObject({ followUpOf: "root" });
  });

  it.each(["assignTask", "updateTask"] as const)("declines moving a pending follow-up to another worker by %s", async (tool) => {
    const b = await board([
      row("root", { status: "completed", assignee: "researcher", attempts: 1, run: { sessionId: "s-root", requestId: "r-root", attempt: 1 } }),
      row("root-f1", { status: "pending", assignee: "researcher", followUpOf: "root" })
    ]);
    const input = tool === "assignTask" ? { taskId: "root-f1", assignee: "writer" } : { taskId: "root-f1", patch: { assignee: "writer" } };
    const out = await b.call(tool, input);
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^follow_up_takes_no_assignee: /) });
    expect(b.get("root-f1")!.assignee).toBe("researcher");
  });

  it("refuses an assignee beside followUpOf at input (BR-22)", async () => {
    const b = await board([row("root", { status: "completed", assignee: "researcher", attempts: 1, run: { sessionId: "s-root", requestId: "r-root", attempt: 1 } })]);
    const out = await b.call("addTask", { goal: "next", followUpOf: "root", assignee: "writer" });
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^follow_up_takes_no_assignee/) });
    expect(b.ref.list()).toHaveLength(1);
  });

  it("answers a task on no board of this caller's as not found, storing nothing (BR-23)", async () => {
    const b = await board([]);
    const out = await b.call("addTask", { goal: "next", followUpOf: "bobs-task" });
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^task_not_found/) });
    expect(b.ref.list()).toHaveLength(0);
  });

  it("allows waitForResponse beside followUpOf, and refuses before anything is filed, so nothing parks (BR-22a)", async () => {
    const b = await board([row("root", { status: "in_progress", assignee: "researcher", attempts: 1 })]);
    // A host that can hold an ask, so addTask carries waitForResponse.
    const ctx = { ...b.ctx, requestHost: { resumeAsk: async () => undefined, hasAskSweeper: true } };
    const tools = taskToolsForTurn(defaultOwnStateResolver)(ctx);
    const addTask = toolNamed(tools, "addTask");
    expect(Object.keys((addTask as any).config.inputSchema.shape)).toEqual(expect.arrayContaining(["followUpOf", "waitForResponse"]));
    const unfinished = (await runForTest(addTask, { goal: "next", followUpOf: "root", waitForResponse: true }, ctx)) as any;
    expect(unfinished).toMatchObject({ ok: false, error: expect.stringMatching(/^follow_up_of_unfinished/) });
    const assigned = (await runForTest(addTask, { goal: "next", followUpOf: "root", assignee: "x", waitForResponse: true }, ctx)) as any;
    expect(assigned).toMatchObject({ ok: false, error: expect.stringMatching(/^follow_up_takes_no_assignee/) });
    expect(b.ref.list()).toHaveLength(1);
  });

  it("accepts one of two follow-ups filed at once, and refuses the other naming it (BR-25, concurrent)", async () => {
    // A durable ledger: its insert takes an id once, as the stores do.
    const ref = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: createFakeResourceCollection(),
      onChange: createCapturedChanges().onChange
    });
    await ranAndCompleted(ref, "root");
    const tools = buildTaskToolsList(async () => ref);
    const { ctx } = buildDelegationCtx({ self: false });
    const file = (goal: string) => runForTest(toolNamed(tools, "addTask"), { goal, followUpOf: "root" }, ctx) as Promise<any>;
    const [one, two] = await Promise.all([file("first"), file("second")]);
    const accepted = [one, two].filter((r) => r.ok === true);
    const refused = [one, two].filter((r) => r.ok === false);
    expect(accepted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].error).toMatch(new RegExp(`^session_has_unfinished_task: task "${accepted[0].taskId}"`));
    expect(ref.list().filter((t) => t.followUpOf === "root")).toHaveLength(1);
  });

  it("refuses while the session has an unfinished task, naming it (BR-25)", async () => {
    const b = await board([
      row("root", { status: "completed", assignee: "researcher", attempts: 1, run: { sessionId: "s-root", requestId: "r-root", attempt: 1 } }),
      row("f1", { status: "in_progress", assignee: "researcher", attempts: 1, followUpOf: "root" })
    ]);
    const out = await b.call("addTask", { goal: "more", followUpOf: "root" });
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^session_has_unfinished_task: task "f1"/) });
    expect(b.ref.list()).toHaveLength(2);
  });
});

describe("parkOnQuestion off a task turn (BR-2)", () => {
  const park = createParkOnQuestion({ resolve: (ctx) => defaultOwnStateResolver(ctx) });

  it("is not offered, and reaches nothing, on a person's turn in the task session (another request)", async () => {
    const b = await board([row("t", { assignee: "w" })]);
    await claimAsGate(b.ref, "t", b.ctx);
    const person = turnCtx(b.ctx, "r-person");
    expect(await park.offered(person as never)).toBe(false);
    // A task id on input is not an input the tool reads.
    const out = (await runForTest(park.tool, { question: "Which?", taskId: "t" } as never, person)) as any;
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^not_a_task_turn/) });
    expect(b.get("t")!.status).toBe("in_progress");
  });

  it("is not offered outside a task session at all", async () => {
    const b = await board([row("t", { assignee: "w" })]);
    expect(await park.offered(b.ctx as never)).toBe(false);
  });
});

describe("parkOnQuestion (S1)", () => {
  const park = createParkOnQuestion({ resolve: (ctx) => defaultOwnStateResolver(ctx) });
  const ask = (ctx: unknown, question = "Which region?") => runForTest(park.tool, { question }, ctx as never) as Promise<any>;

  it("parks the row the turn's claim holds, with its question (BR-1)", async () => {
    const b = await board([row("t", { assignee: "w" })]);
    const turn = await claimAsGate(b.ref, "t", b.ctx);
    expect(await ask(turn)).toEqual({ ok: true, taskId: "t", status: "parked" });
    expect(b.get("t")).toMatchObject({ status: "parked", feedback: "Which region?" });
  });

  it("declines a second call in the same turn, naming the status, and writes nothing (BR-3, BR-5)", async () => {
    const b = await board([row("t", { assignee: "w" })]);
    const turn = await claimAsGate(b.ref, "t", b.ctx);
    await ask(turn);
    const second = await ask(turn, "And the account?");
    expect(second).toMatchObject({ ok: false, error: expect.stringMatching(/^park_declined: .*parked/) });
    expect(b.get("t")!.feedback).toBe("Which region?");
  });

  it("declines once the claim was displaced (a cancel landed), writing nothing (BR-3)", async () => {
    const b = await board([row("t", { assignee: "w" })]);
    const turn = await claimAsGate(b.ref, "t", b.ctx);
    await b.ref.cancel("t");
    const out = await ask(turn);
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^park_declined: .*cancelled/) });
    expect(b.get("t")!.status).toBe("cancelled");
  });

  it("is not offered, and declines, on an asked row (BR-1a, ER-22)", async () => {
    const b = await board([row("t", { assignee: "w", ask: { gateId: "g", deadline: 9e12 } })]);
    const turn = await claimAsGate(b.ref, "t", b.ctx);
    expect(await park.offered(turn as never)).toBe(false);
    expect(await ask(turn)).toMatchObject({ ok: false, error: expect.stringMatching(/^asked_task/) });
    expect(b.get("t")!.status).toBe("in_progress");
  });

  it("is offered on a task turn working a row that isn't asked (BR-1a)", async () => {
    const b = await board([row("t", { assignee: "w", followUpOf: "root" })]);
    const turn = await claimAsGate(b.ref, "t", b.ctx);
    expect(await park.offered(turn as never)).toBe(true);
  });
});
