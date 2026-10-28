/**
 * `updateTask`'s `message` and the task view's `current` (FIX-2086).
 * Each case reads the tool's answer and the row, so a refusal that wrote
 * anything anyway fails here.
 */
import { describe, expect, it, vi } from "vitest";
import type { GeneratorTool } from "@flow-state-dev/core";
import { runForTest } from "@flow-state-dev/testing";
import { buildTaskToolsList, READ_OUTPUT_LIMIT, taskToolActions } from "../../src/skills/task-tools-capability";
import { MAX_STEERS, ticketForClaim, type Task, type TaskCollectionRef } from "../../src/tasks";
import { buildDelegationCtx, ownStateResolver } from "./delegation-ctx";

function toolNamed(tools: readonly unknown[], name: string): GeneratorTool {
  const tool = tools.find((t) => (t as { config?: { name?: string } }).config?.name === name);
  if (tool === undefined) throw new Error(`tool not found: ${name}`);
  return tool as GeneratorTool;
}

/** An empty board, its tools, and a reader for its rows. */
async function board() {
  const { ctx } = buildDelegationCtx({ self: false });
  const tools = buildTaskToolsList(ownStateResolver);
  const ref = (await ownStateResolver(ctx as never))!;
  const call = (name: string, input: unknown) => runForTest(toolNamed(tools, name), input, ctx) as Promise<any>;
  return { ctx, ref, call, get: (id: string) => ref.get(id) as Task | undefined };
}

/** File `id`, claim it, and settle it as `ending` with `output`. */
async function ran(ref: TaskCollectionRef, id: string, ending: "completed" | "errored" | "cancelled", output: unknown, followUpOf?: string) {
  await ref.createTask({ id, goal: `do ${id}`, ...(followUpOf !== undefined ? { followUpOf } : {}) });
  const claimed = (await ref.claim("w", { eligibility: (t) => t.id === id }))!;
  const claim = { claim: ticketForClaim(ref.collectionId, claimed, ref.partition) };
  if (ending === "completed") await ref.complete(id, output, claim);
  if (ending === "errored") await ref.fail(id, "boom", claim);
  if (ending === "cancelled") await ref.cancel(id);
}

describe("updateTask's message (FIX-2086)", () => {
  it("steers a task that hasn't started: the words join its brief, and nothing else changes", async () => {
    const b = await board();
    await b.ref.createTask({ id: "t", goal: "count the rows" });

    expect(await b.call("updateTask", { id: "t", message: "Use the North America numbers" })).toEqual({ ok: true });

    const row = b.get("t")!;
    expect(row).toMatchObject({ status: "pending", attempts: 0, goal: "count the rows" });
    expect(row.steers).toEqual([expect.objectContaining({ message: "Use the North America numbers", from: "filer" })]);
    // Readable through getTask (D1), not taken until an attempt reads it.
    expect((await b.call("getTask", { id: "t" })).task.steers).toEqual([
      { message: "Use the North America numbers", from: "filer", at: expect.any(Number), taken: false },
    ]);
  });

  it("steers a running task without using an attempt, ending it or cancelling it", async () => {
    const b = await board();
    await b.ref.createTask({ id: "t", goal: "count the rows" });
    const claimed = (await b.ref.claim("w"))!;

    expect(await b.call("updateTask", { id: "t", message: "Skip the archive" })).toEqual({ ok: true });

    expect(b.get("t")).toMatchObject({ status: "in_progress", attempts: 1, leaseUntil: claimed.leaseUntil });
    expect(b.get("t")!.steers!.map((steer) => steer.message)).toEqual(["Skip the archive"]);
  });

  it.each(["completed", "errored", "cancelled"] as const)(
    "refuses a %s task, naming the rule and the move, and writes nothing",
    async (ending) => {
      const b = await board();
      await ran(b.ref, "t", ending, "the answer");
      const before = JSON.stringify(b.get("t"));

      const out = await b.call("updateTask", { id: "t", message: "Make it shorter" });

      expect(out.ok).toBe(false);
      expect(out.error).toMatch(/^task_finished: /);
      expect(out.error).toContain("a finished task takes no message; file a follow-up");
      expect(out.error).toContain(`createTask({ followUpOf: "t" })`);
      expect(JSON.stringify(b.get("t"))).toBe(before);
    }
  );

  it.each([
    ["an edit", { goal: "count every row" }, "goal"],
    ["a hold", { status: "held" }, "status"],
  ] as const)("never half-applies: a message sent with %s is refused, and neither is written", async (_label, edit, named) => {
    // Two writes can't be one: the edit could land and the steer be refused
    // (a finish or the limit in between), so the pair is refused up front.
    const b = await board();
    await b.ref.createTask({ id: "t", goal: "count the rows" });
    const before = JSON.stringify(b.get("t"));

    const out = await b.call("updateTask", { id: "t", ...edit, message: "and the totals" });

    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(new RegExp(`^message_takes_no_edits: .*${named}`)) });
    expect(JSON.stringify(b.get("t"))).toBe(before);
  });

  it(`refuses a message past ${MAX_STEERS}, naming the limit, and writes nothing`, async () => {
    const b = await board();
    await b.ref.createTask({ id: "t", goal: "count the rows" });
    for (let i = 0; i < MAX_STEERS; i += 1) await b.call("updateTask", { id: "t", message: `steer ${i}` });
    const before = JSON.stringify(b.get("t"));

    const out = await b.call("updateTask", { id: "t", message: "one more" });

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/^steer_limit: /);
    expect(out.error).toContain(String(MAX_STEERS));
    expect(JSON.stringify(b.get("t"))).toBe(before);
  });

  it("refuses a message sent with a cancel", async () => {
    const b = await board();
    await b.ref.createTask({ id: "t", goal: "count the rows" });
    const out = await b.call("updateTask", { id: "t", status: "cancelled", message: "never mind" });
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^cancel_takes_no_edits:/) });
    expect(b.get("t")).toMatchObject({ status: "pending" });
    expect(b.get("t")!.steers).toBeUndefined();
  });

  it("from a screen, the updateTask_<board> action steers as the user", async () => {
    const b = await board();
    await b.ref.createTask({ id: "t", goal: "count the rows" });
    const actions = taskToolActions("desk", ownStateResolver);
    const asAlice = { ...(b.ctx as object), user: { identity: { userId: "u_alice" } } };

    const out = await runForTest(actions["updateTask_desk"]!.block as never, { id: "t", message: "Use March" } as never, asAlice as never);

    expect(out).toEqual({ ok: true });
    expect(b.get("t")!.steers).toEqual([expect.objectContaining({ message: "Use March", from: "user", by: "u_alice" })]);
  });
});

describe("the task view's current (D3)", () => {
  it("getTask reads the latest completed follow-up as current, and keeps the task's own output", async () => {
    const b = await board();
    await ran(b.ref, "root", "completed", "the long report");
    await ran(b.ref, "f1", "completed", "the short report", "root");
    await ran(b.ref, "f2", "errored", undefined, "root");
    await ran(b.ref, "f3", "cancelled", undefined, "root");

    const out = await b.call("getTask", { id: "root" });

    expect(out.task.output).toBe("the long report");
    expect(out.task.current).toEqual({ id: "f1", output: "the short report" });
    expect(b.get("root")!.output).toBe("the long report");
  });

  it("a later completed follow-up is current over an earlier one, read from any task in the chain", async () => {
    // A stepping clock: each one finishes a second after the one before.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const b = await board();
      vi.setSystemTime(1_000);
      await ran(b.ref, "root", "completed", "v1");
      vi.setSystemTime(2_000);
      await ran(b.ref, "f1", "completed", "v2", "root");
      vi.setSystemTime(3_000);
      await ran(b.ref, "f2", "completed", "v3", "root");

      expect((await b.call("getTask", { id: "root" })).task.current).toEqual({ id: "f2", output: "v3" });
      expect((await b.call("getTask", { id: "f1" })).task.current).toEqual({ id: "f2", output: "v3" });
      // The latest one is current itself: it names no other.
      expect((await b.call("getTask", { id: "f2" })).task).not.toHaveProperty("current");
    } finally {
      vi.useRealTimers();
    }
  });

  it("two follow-ups that complete in the same millisecond order the same way every time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(5_000);
      const b = await board();
      await ran(b.ref, "root", "completed", "v1");
      await ran(b.ref, "root-f2", "completed", "v2", "root");
      await ran(b.ref, "root-f10", "completed", "v3", "root");
      // Same completion and filing time: the higher-numbered follow-up is current.
      expect((await b.call("getTask", { id: "root" })).task.current).toEqual({ id: "root-f10", output: "v3" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("has no current while no follow-up completed", async () => {
    const b = await board();
    await ran(b.ref, "root", "completed", "v1");
    await ran(b.ref, "f1", "errored", undefined, "root");
    await b.ref.createTask({ id: "f2", goal: "do f2", followUpOf: "root" });

    expect((await b.call("getTask", { id: "root" })).task).not.toHaveProperty("current");
  });

  it("cuts current's output as the task's own", async () => {
    const b = await board();
    await ran(b.ref, "root", "completed", "v1");
    await ran(b.ref, "f1", "completed", "x".repeat(READ_OUTPUT_LIMIT + 10), "root");

    const current = (await b.call("getTask", { id: "root" })).task.current;
    expect(current).toMatchObject({ id: "f1", outputCut: true });
    expect((current.output as string).length).toBe(READ_OUTPUT_LIMIT);
  });

  it("listTasks names current by id and carries no output", async () => {
    const b = await board();
    await ran(b.ref, "root", "completed", "v1");
    await ran(b.ref, "f1", "completed", "v2", "root");

    const rows = (await b.call("listTasks", {})).tasks as Array<Record<string, unknown>>;
    const root = rows.find((row) => row.id === "root")!;
    expect(root.current).toEqual({ id: "f1" });
    expect(JSON.stringify(rows)).not.toContain("v2");
  });
});
