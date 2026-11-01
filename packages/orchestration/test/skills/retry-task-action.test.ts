/**
 * `retryTask_<board>` (FIX-2383): a screen's Retry on a failed or cancelled
 * task, through the board's public actions.
 *
 * It is a person's or an app's move, never a model's: a model with a reopen
 * on a board that counts but can't cap retries could loop on a failing task,
 * and it already has follow-ups. And because a retried task is the same task,
 * its next ending must reach its filer as a new notice, not be read as the
 * one already sent.
 */
import { describe, expect, it } from "vitest";
import type { GeneratorTool } from "@flow-state-dev/core";
import { runForTest } from "@flow-state-dev/testing";
import { buildTaskToolsList, taskToolActions, taskToolSuffix } from "../../src/skills/task-tools-capability";
import { createResourceBackedTaskCollection, type Task, type TaskCollectionRef } from "../../src/tasks";
import { createFakeResourceCollection } from "../helpers";
import { buildDelegationCtx, ownStateResolver } from "./delegation-ctx";

function toolNamed(tools: readonly unknown[], name: string): GeneratorTool {
  const tool = tools.find((t) => (t as { config?: { name?: string } }).config?.name === name);
  if (tool === undefined) throw new Error(`tool not found: ${name}`);
  return tool as GeneratorTool;
}

/** An empty board, its filer's tools and a screen's actions, as user u1. */
async function board() {
  const { ctx } = buildDelegationCtx({ self: false });
  const tools = buildTaskToolsList(ownStateResolver);
  const actions = taskToolActions("desk", ownStateResolver);
  const ref = (await ownStateResolver(ctx as never))!;
  const call = (name: string, input: unknown) => runForTest(toolNamed(tools, name), input, ctx) as Promise<any>;
  const act = (name: string, input: unknown, as: { userId?: string; tenantId?: string } = {}) => {
    const identity = { ...(ctx as any).request.identity, userId: "u1", ...as };
    const caller = { ...(ctx as object), request: { ...(ctx as any).request, identity }, user: { identity: { userId: identity.userId } } };
    return runForTest(actions[`${name}_desk`]!.block as never, input as never, caller as never) as Promise<any>;
  };
  /** File a task as u1 and fail its one attempt. */
  const failed = async (): Promise<string> => {
    const filed = await call("createTask", { goal: "Fix the export" });
    await ref.claim("w", { leaseDurationMs: 10_000 });
    await ref.fail(filed.taskId, "no model key");
    return filed.taskId;
  };
  return { ctx, ref, tools, actions, act, failed, get: (id: string) => ref.get(id) as Task | undefined };
}

describe("retryTask", () => {
  it("is a screen's action, and no tool a model holds", async () => {
    const b = await board();
    expect(Object.keys(b.actions)).toContain("retryTask_desk");
    const modelTools = b.tools.map((tool) => (tool as { config?: { name?: string } }).config?.name);
    expect(modelTools).toEqual(["createTask", "getTask", "listTasks", "updateTask"]);
  });

  it("puts a failed task back to waiting, the same task", async () => {
    const b = await board();
    const id = await b.failed();
    expect(await b.act("retryTask", { id })).toEqual({ ok: true });
    expect(b.get(id)).toMatchObject({ id, status: "pending", feedback: "no model key" });
  });

  it("refuses a completed task with the follow-up move, writing nothing", async () => {
    const b = await board();
    const filed = await b.act("createTask", { goal: "Fix the export" });
    await b.ref.claim("w", { leaseDurationMs: 10_000 });
    await b.ref.complete(filed.taskId, "done");
    const out = await b.act("retryTask", { id: filed.taskId });
    expect(out).toMatchObject({ ok: false, taskId: filed.taskId, error: expect.stringMatching(/^task_finished: .*followUpOf/) });
    expect(b.get(filed.taskId)!.status).toBe("completed");
  });

  it("refuses an open task, naming what it can take instead", async () => {
    const b = await board();
    const filed = await b.act("createTask", { goal: "Fix the export" });
    expect(await b.act("retryTask", { id: filed.taskId })).toMatchObject({ ok: false, error: expect.stringMatching(/^not_finished: .*is pending/) });
  });

  it("names the dependency to retry first", async () => {
    const b = await board();
    const first = await b.act("createTask", { goal: "Fix the export" });
    const dependent = await b.act("createTask", { goal: "Ship it", deps: [first.taskId] });
    await b.ref.claim("w", { leaseDurationMs: 10_000 });
    await b.ref.fail(first.taskId, "no model key");
    await b.ref.payOwedCascades?.();
    expect(b.get(dependent.taskId)).toMatchObject({ status: "cancelled", causedBy: first.taskId });
    expect(await b.act("retryTask", { id: dependent.taskId })).toMatchObject({
      ok: false,
      error: expect.stringMatching(new RegExp(`^dependency_ended: .*"${first.taskId}".*Retry it first`)),
    });
  });

  it("answers another user as not found, with nothing written", async () => {
    const b = await board();
    const id = await b.failed();
    expect(await b.act("retryTask", { id }, { userId: "u2" })).toEqual({ ok: false, error: "task_not_found", taskId: id });
    expect(b.get(id)!.status).toBe("errored");
  });
});

describe("a retried task's next ending", () => {
  it("owes its filer a new notice, beside the first failure's", async () => {
    const FILER = "filer-session";
    const ref: TaskCollectionRef = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: createFakeResourceCollection(),
      delivery: {
        ownSession: FILER,
        hooks: { filerOf: () => FILER, beforeEnding: async () => {}, owePassAt: async () => {}, afterEnding: async () => {} },
      },
    });
    await ref.createTask({ id: "t", goal: "t" });
    const owed = () => Object.keys(ref.get("t")?.metadata ?? {}).filter((key) => key.startsWith("noticeOwed:"));

    await ref.claim("w", { leaseDurationMs: 10_000 });
    await ref.fail("t", "first");
    expect(owed()).toHaveLength(1);

    const { ctx } = buildDelegationCtx({ self: false });
    const action = taskToolActions("tasks", async () => ref)[`retryTask_${taskToolSuffix("tasks")}`]!;
    expect(await runForTest(action.block as never, { id: "t" } as never, ctx)).toEqual({ ok: true });
    // A retry is not an ending: it owes nobody a notice of its own.
    expect(owed()).toHaveLength(1);

    await ref.claim("w", { leaseDurationMs: 10_000 });
    await ref.fail("t", "second");
    expect(owed()).toHaveLength(2);
  });
});
