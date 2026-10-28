/**
 * A task held on questions through the task tools (FIX-2133): `createTask`'s
 * `questions` (and `confirm`), `updateTask`'s `question`, and the open holds
 * `getTask` and `listTasks` show. The answer path is the board's own
 * `updateTask`, scoped to the caller (D1); the filer's tool answers only a
 * question its worker asked it midway, on a task not routed (ER-4).
 *
 * Each case reads the tool's answer and the row, so a refusal that wrote
 * anything anyway fails here.
 */
import { describe, expect, it } from "vitest";
import type { GeneratorTool } from "@flow-state-dev/core";
import { runForTest } from "@flow-state-dev/testing";
import { buildTaskToolsList, taskToolActions } from "../../src/skills/task-tools-capability";
import { MAX_STEERS, openHolds, ticketForClaim, type Task } from "../../src/tasks";
import { buildDelegationCtx, ownStateResolver } from "./delegation-ctx";

function toolNamed(tools: readonly unknown[], name: string): GeneratorTool {
  const tool = tools.find((t) => (t as { config?: { name?: string } }).config?.name === name);
  if (tool === undefined) throw new Error(`tool not found: ${name}`);
  return tool as GeneratorTool;
}

const CSV = "Which CSV export should the script read?";
const COLUMN = "Which date column?";

/** An empty board, its tools (the filer's) and its actions (a screen's), as user u1. */
async function board() {
  const { ctx } = buildDelegationCtx({ self: false });
  const tools = buildTaskToolsList(ownStateResolver);
  const actions = taskToolActions("desk", ownStateResolver);
  const ref = (await ownStateResolver(ctx as never))!;
  const call = (name: string, input: unknown) => runForTest(toolNamed(tools, name), input, ctx) as Promise<any>;
  /** A screen's call, as the signed-in caller `as` (u1 by default, no tenant, no org). */
  const act = (name: string, input: unknown, as: { userId?: string; tenantId?: string; orgId?: string } = {}) => {
    const identity = { ...(ctx as any).request.identity, userId: "u1", ...as };
    const caller = { ...(ctx as object), request: { ...(ctx as any).request, identity }, user: { identity: { userId: identity.userId } } };
    return runForTest(actions[`${name}_desk`]!.block as never, input as never, caller as never) as Promise<any>;
  };
  return { ctx, ref, call, act, get: (id: string) => ref.get(id) as Task | undefined };
}

describe("createTask's questions", () => {
  it("files a task held on its questions and a confirm: pending, with one open hold each, shown by getTask and listTasks", async () => {
    const b = await board();
    const filed = await b.call("createTask", { goal: "Write the adoption script", questions: [CSV, { kind: "confirm", prompt: "Run it against prod?" }] });
    expect(filed).toMatchObject({ ok: true });
    const row = b.get(filed.taskId)!;
    expect(row).toMatchObject({ status: "pending", attempts: 0 });
    expect(openHolds(row).map((hold) => hold.ask)).toEqual([
      { kind: "question", prompt: CSV },
      { kind: "confirm", prompt: "Run it against prod?", onNo: "cancel" },
    ]);
    const read = await b.call("getTask", { id: filed.taskId });
    expect(read.task.holds.map((hold: { ask: unknown }) => hold.ask)).toEqual(openHolds(row).map((hold) => hold.ask));
    const listed = await b.call("listTasks", {});
    expect(listed.tasks[0].holds).toHaveLength(2);
  });

  // Smaller models send `questions: []` even when told to leave it out; a refusal there makes
  // them invent a question that holds the task, or file nothing (FIX-2277).
  it("takes an empty questions list as no questions: filed with no hold, like a filing that leaves the field out", async () => {
    const b = await board();
    const filed = await b.call("createTask", { goal: "Write the adoption script", questions: [] });
    expect(filed).toMatchObject({ ok: true });
    const row = b.get(filed.taskId)!;
    expect(openHolds(row)).toEqual([]);
    expect(row.holds ?? []).toEqual([]);
    const plain = await b.call("createTask", { goal: "Write the adoption script" });
    expect(row.status).toBe(b.get(plain.taskId)!.status);
  });

  it("refuses questions a task can't keep, filing nothing", async () => {
    const b = await board();
    const out = await b.call("createTask", { goal: "g", questions: ["?".repeat(1_001)] });
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^questions_not_kept:/) });
    expect(b.ref.list()).toEqual([]);
  });
});

describe("updateTask's question", () => {
  async function held() {
    const b = await board();
    const filed = await b.call("createTask", { goal: "Write the adoption script", questions: [CSV, COLUMN] });
    const [csv, column] = openHolds(b.get(filed.taskId)!).map((hold) => hold.id);
    return { ...b, id: filed.taskId as string, csv: csv!, column: column! };
  }

  it("from a screen, answers a question as the user: kept as a steer naming it, the others left open", async () => {
    const b = await held();
    expect(await b.act("updateTask", { id: b.id, question: b.csv, message: "The March export" })).toEqual({ ok: true });
    expect(openHolds(b.get(b.id)!).map((hold) => hold.id)).toEqual([b.column]);
    const read = await b.call("getTask", { id: b.id });
    expect(read.task.steers).toEqual([expect.objectContaining({ message: "The March export", from: "user", by: "u1", answers: b.csv })]);
    expect(read.task.holds.map((hold: { id: string }) => hold.id)).toEqual([b.column]);
  });

  it("a retried answer is a success; other words are refused as answered", async () => {
    const b = await held();
    await b.act("updateTask", { id: b.id, question: b.csv, message: "The March export" });
    expect(await b.act("updateTask", { id: b.id, question: b.csv, message: "The March export" })).toEqual({ ok: true });
    expect(await b.act("updateTask", { id: b.id, question: b.csv, message: "The April export" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^question_answered:/),
    });
    expect(b.get(b.id)!.steers).toHaveLength(1);
  });

  it("another user, tenant or org is answered as not found, with nothing written", async () => {
    const b = await held();
    for (const as of [{ userId: "u2" }, { tenantId: "t-other" }]) {
      expect(await b.act("updateTask", { id: b.id, question: b.csv, message: "x" }, as)).toEqual({ ok: false, error: "task_not_found", taskId: b.id });
    }
    // A row filed under an org is reached only from it.
    const { ctx } = buildDelegationCtx({ self: false });
    (ctx as any).request.identity.orgId = "org-a";
    const filed = await runForTest(toolNamed(buildTaskToolsList(ownStateResolver), "createTask"), { goal: "g", questions: [CSV] } as never, ctx) as any;
    const ref = (await ownStateResolver(ctx as never))!;
    const hold = openHolds(ref.get(filed.taskId)!)[0]!.id;
    const actions = taskToolActions("desk", ownStateResolver);
    const asOrg = (orgId: string) => ({ ...(ctx as object), request: { ...(ctx as any).request, identity: { id: "r9", userId: "u1", orgId } }, user: { identity: { userId: "u1" } } });
    expect(await runForTest(actions["updateTask_desk"]!.block as never, { id: filed.taskId, question: hold, message: "x" } as never, asOrg("org-b") as never)).toMatchObject({ ok: false, error: "task_not_found" });
    expect(await runForTest(actions["updateTask_desk"]!.block as never, { id: filed.taskId, question: hold, message: "x" } as never, asOrg("org-a") as never)).toEqual({ ok: true });
    expect(b.get(b.id)!.steers).toBeUndefined();
  });

  it("a confirm takes done, with an optional note; words alone are refused", async () => {
    const b = await board();
    const filed = await b.call("createTask", { goal: "Ship v2", questions: [{ kind: "confirm", prompt: "Ship once it builds?" }] });
    const hold = openHolds(b.get(filed.taskId)!)[0]!.id;
    expect(await b.act("updateTask", { id: filed.taskId, question: hold, message: "yes please" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^confirm_takes_done:/),
    });
    expect(await b.act("updateTask", { id: filed.taskId, question: hold, done: true, message: "after lunch" })).toEqual({ ok: true });
    expect(b.get(filed.taskId)!.steers).toEqual([expect.objectContaining({ message: "Yes, go ahead. after lunch", answers: hold })]);
    expect(openHolds(b.get(filed.taskId)!)).toEqual([]);
  });

  it("a No on a confirm cancels the task by default, the No and its note its reason; the same No again is a success", async () => {
    const b = await board();
    const filed = await b.call("createTask", { goal: "Ship v2", questions: [{ kind: "confirm", prompt: "Ship once it builds?" }] });
    const hold = openHolds(b.get(filed.taskId)!)[0]!.id;
    expect(await b.act("updateTask", { id: filed.taskId, question: hold, done: false, message: "not this week" })).toEqual({ ok: true });
    const row = b.get(filed.taskId)!;
    expect(row).toMatchObject({ status: "cancelled", attempts: 0, error: 'No to "Ship once it builds?": not this week', cancelledVia: "action" });
    expect(await b.ref.claim("w")).toBeNull();
    // A retry after the cancel landed; a different answer is refused as finished.
    expect(await b.act("updateTask", { id: filed.taskId, question: hold, done: false, message: "not this week" })).toEqual({ ok: true });
    expect(await b.act("updateTask", { id: filed.taskId, question: hold, done: true })).toMatchObject({ ok: false, error: expect.stringMatching(/^task_finished:/) });
  });

  it("a No sent after the yes is refused as answered, and the task stays as the yes left it", async () => {
    const b = await board();
    const filed = await b.call("createTask", { goal: "Ship v2", questions: [{ kind: "confirm", prompt: "Ship once it builds?" }] });
    const hold = openHolds(b.get(filed.taskId)!)[0]!.id;
    expect(await b.act("updateTask", { id: filed.taskId, question: hold, done: true })).toEqual({ ok: true });
    expect(await b.act("updateTask", { id: filed.taskId, question: hold, done: false })).toMatchObject({ ok: false, error: expect.stringMatching(/^question_answered:/) });
    expect(b.get(filed.taskId)).toMatchObject({ status: "pending" });
  });

  it("a confirm filed with onNo: continue goes on after a No, with the No in its brief", async () => {
    const b = await board();
    const filed = await b.call("createTask", { goal: "Ship v2", questions: [{ kind: "confirm", prompt: "Ship once it builds?", onNo: "continue" }] });
    const hold = openHolds(b.get(filed.taskId)!)[0]!;
    expect(hold.ask).toEqual({ kind: "confirm", prompt: "Ship once it builds?", onNo: "continue" });
    expect(await b.act("updateTask", { id: filed.taskId, question: hold.id, done: false })).toEqual({ ok: true });
    expect(b.get(filed.taskId)!.steers).toEqual([expect.objectContaining({ message: "No.", answers: hold.id })]);
    expect(await b.ref.claim("w")).toMatchObject({ id: filed.taskId, status: "in_progress", attempts: 1 });
  });

  it("a No on a confirm asked midway cancels the task it holds, through the same cancel", async () => {
    const b = await board();
    const filed = await b.call("createTask", { goal: "Clean the export" });
    const claimed = (await b.ref.claim("w", { leaseDurationMs: 10_000 }))!;
    const asked = await b.ref.ask!(filed.taskId, [{ kind: "confirm", prompt: "Drop the empty rows?" }], { claim: ticketForClaim(b.ref.collectionId, claimed) });
    expect(asked.outcome).toBe("recorded");
    expect(await b.act("updateTask", { id: filed.taskId, question: asked.holds![0]!, done: false })).toEqual({ ok: true });
    expect(b.get(filed.taskId)).toMatchObject({ status: "cancelled", attempts: 1, error: 'No to "Drop the empty rows?"' });
  });

  it("the filer's own tool answers no question asked at filing: those are the user's", async () => {
    const b = await held();
    expect(await b.call("updateTask", { id: b.id, question: b.csv, message: "The March export" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^question_is_the_users:/),
    });
    expect(b.get(b.id)!.steers).toBeUndefined();
  });

  it("the filer's own tool answers a question its worker asked midway, on a task not routed, as the filer", async () => {
    const b = await board();
    await b.ref.addTask({ id: "t4", goal: "clean the export" });
    const claimed = (await b.ref.claim("w"))!;
    const asked = await b.ref.ask!("t4", [{ kind: "question", prompt: COLUMN }], { claim: ticketForClaim(b.ref.collectionId, claimed) });
    const hold = asked.holds![0]!;
    expect(await b.call("updateTask", { id: "t4", question: hold, message: "signup_date" })).toEqual({ ok: true });
    expect(b.get("t4")).toMatchObject({ turnOwed: true, steers: [expect.objectContaining({ from: "filer", answers: hold })] });
  });

  it("the filer's own tool answers no midway question on a task routed to a workstream: the user answers it in that session", async () => {
    for (const routed of [{ targetSessionId: "s_workstream" }, { target: "pricing-page" }]) {
      const b = await board();
      await b.ref.addTask({ id: "t5", goal: "clean the export", ...routed });
      const claimed = (await b.ref.claim("w"))!;
      const asked = await b.ref.ask!("t5", [{ kind: "question", prompt: COLUMN }], { claim: ticketForClaim(b.ref.collectionId, claimed) });
      const hold = asked.holds![0]!;
      expect(await b.call("updateTask", { id: "t5", question: hold, message: "signup_date" })).toMatchObject({
        ok: false,
        error: expect.stringMatching(/^question_is_the_users: .*, since the task runs in a workstream/),
      });
      expect(b.get("t5")!.steers).toBeUndefined();
      expect(openHolds(b.get("t5")!).map((h) => h.id)).toEqual([hold]);
    }
  });

  it("an answer is sent alone, and names its question", async () => {
    const b = await held();
    expect(await b.act("updateTask", { id: b.id, question: b.csv, message: "x", priority: 2 })).toMatchObject({ ok: false, error: expect.stringMatching(/^answer_takes_no_edits:/) });
    expect(await b.act("updateTask", { id: b.id, question: "hold_nope", message: "x" })).toMatchObject({ ok: false, error: expect.stringMatching(/^no_such_question:/) });
    expect(await b.act("updateTask", { id: b.id, done: true })).toMatchObject({ ok: false, error: expect.stringMatching(/^done_without_question:/) });
    expect(b.get(b.id)!.steers).toBeUndefined();
  });

  it("an ordinary message is refused once the steers and the open questions reach the cap, and an answer still lands", async () => {
    const b = await held();
    for (let i = 0; i < MAX_STEERS - 2; i += 1) await b.ref.steer!(b.id, { message: `m${i}`, from: "filer" });
    expect(await b.call("updateTask", { id: b.id, message: "one more" })).toMatchObject({ ok: false, error: expect.stringMatching(/^steer_limit:/) });
    expect(await b.act("updateTask", { id: b.id, question: b.csv, message: "The March export" })).toEqual({ ok: true });
  });
});
