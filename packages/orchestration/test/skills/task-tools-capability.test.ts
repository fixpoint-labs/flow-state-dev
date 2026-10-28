import { describe, expect, it } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import {
  buildTaskToolsList,
  checkAssignee,
  createTaskToolsCapability,
  READ_OUTPUT_LIMIT,
  type AssigneeRoster,
} from "../../src/skills/task-tools-capability";
import { BOARD_FIELD, buildDelegationCtx, ownStateResolver } from "./delegation-ctx";
import type { GeneratorTool } from "@flow-state-dev/core";

const taskTools = createTaskToolsCapability(ownStateResolver);

/** The capability's tool list as a turn with no ask host gets it: the list is chosen per turn (FIX-1816). */
const resolvedControlTools = (list: unknown): GeneratorTool[] =>
  (typeof list === "function" ? list({}) : (list ?? [])) as GeneratorTool[];

/** Build a context whose parent exposes no delegation board (→ no_delegation_board). */
function buildNoBoardCtx() {
  return {
    // No `parent` — the own-state resolver returns undefined.
    request: { identity: { id: "r1", userId: "u1" }, state: {} },
    session: {
      identity: { id: "s1", userId: "u1" },
      state: {},
      patchState: async () => {},
    },
    org: { identity: { type: "org" as const, id: "p1" } },
    user: {},
    resources: { get: () => undefined, list: () => [] },
    signal: new AbortController().signal,
    response: { emit: async () => {}, getItems: () => [] },
    cap: {},
    getTarget: () => undefined,
    getBlockOutput: () => undefined,
    getBlockResult: () => ({ status: "not_started" as const }),
    targets: {},
    emit: { message: () => {}, component: () => {}, status: () => {} },
  } as never;
}

/**
 * This file drives task tools directly, with no generator/tool-executor in
 * between, so it needs `ctx.self` to differ from `ctx.parent` — with the
 * fixture's default alias, a resolver that read `ctx.self` instead of
 * `ctx.parent` would still find the right board and these tests would never
 * notice (see delegation-ctx.ts).
 */
function buildCtx(opts?: Parameters<typeof buildDelegationCtx>[0]) {
  return buildDelegationCtx({ ...opts, self: false });
}

/**
 * Look up a tool by name from the capability's preset surface.
 *
 * These live under `controlTools`, not `tools` (FIX-1393): the delegation board
 * is a framework control a block holds because it asked for a board, so a
 * consuming block's `tools:` fence must not cut it off.
 */
function findTool(name: string): GeneratorTool {
  const presetDefs = (taskTools as unknown as {
    __presetDefs?: { tools?: { controlTools?: unknown } };
  }).__presetDefs;
  const tool = resolvedControlTools(presetDefs?.tools?.controlTools).find((t) => t.config?.name === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool;
}

/** A task row as the board stores it. */
type Row = {
  status: string;
  goal: string;
  title?: string;
  context?: string;
  input?: unknown;
  assignee?: string;
  priority?: number;
  labels?: string[];
  metadata?: Record<string, unknown>;
  deps?: string[];
  maxAttempts?: number;
  cancelledVia?: string;
};

/** The live board record off a mock ctx. */
function boardOf(ctx: unknown): Record<string, Row> {
  return (ctx as { parent: { state: Record<string, unknown> } }).parent.state[BOARD_FIELD] as Record<string, Row>;
}

/** Seed a board holding exactly one task `a` in `status`, plus any extra fields. */
function ctxWithTask(status: string, extra: Record<string, unknown> = {}) {
  return buildCtx({
    preTasks: {
      a: { id: "a", goal: "x", status, attempts: 0, createdAt: Date.now(), updatedAt: Date.now(), ...extra },
      // A task `a` may come to depend on.
      b: { id: "b", goal: "y", status: "pending", attempts: 0, createdAt: Date.now(), updatedAt: Date.now() },
    },
  }).ctx;
}

describe("taskTools capability", () => {
  it("offers the filer's four task tools, and nothing that settles a task (FIX-2081, FIX-2131)", () => {
    const presetDefs = (taskTools as unknown as {
      __presetDefs?: { tools?: { controlTools?: unknown } };
    }).__presetDefs;
    const names = resolvedControlTools(presetDefs?.tools?.controlTools).map((t) => t.config?.name).sort();
    expect(names).toEqual(["createTask", "getTask", "listTasks", "updateTask"]);
  });

  it("createTaskToolsCapability returns a freshly composable capability", () => {
    const cap = createTaskToolsCapability(ownStateResolver);
    expect(cap.name).toBe("taskTools");
  });

  it("createTask documents both creation caps it can return", () => {
    const description = findTool("createTask").config?.description ?? "";
    expect(description).toContain("enqueued_task_cap_exceeded");
    expect(description).toContain("total_task_cap_exceeded");
  });
});

describe("createTask", () => {
  it("files a task on the delegation board, starting at once", async () => {
    const { ctx } = buildCtx();
    const result = (await runForTest(findTool("createTask"), { goal: "write report" }, ctx)) as { ok: boolean; taskId: string };
    expect(result.ok).toBe(true);
    expect(result.taskId).toMatch(/^task_/);
    expect(boardOf(ctx)[result.taskId]?.status).toBe("pending");
  });

  it("stores the brief's fields and a structured input on the task", async () => {
    const { ctx } = buildCtx();
    const result = (await runForTest(
      findTool("createTask"),
      { goal: "analyze", context: "for the board meeting", assignee: "analyst", input: { subject: "ACME" }, labels: ["q3"], priority: 2 },
      ctx,
    )) as { taskId: string };
    expect(boardOf(ctx)[result.taskId]).toMatchObject({
      goal: "analyze",
      context: "for the board meeting",
      assignee: "analyst",
      input: { subject: "ACME" },
      labels: ["q3"],
      priority: 2,
    });
  });

  // A notice marker decides what the filer hears; only an ending's write sets
  // one, so a caller's metadata can't forge one (BP-031, FIX-2078).
  it("files no notice marker a caller's metadata names, on createTask and on updateTask", async () => {
    const { ctx } = buildCtx();
    const forged = {
      "noticeOwed:0:completed": { attempt: 0, ending: "completed", due: 0 },
      "noticeUndeliverable:0:completed": { at: 0, detail: "x" },
      note: "kept",
    };
    const result = (await runForTest(findTool("createTask"), { goal: "forged", held: true, metadata: forged }, ctx)) as { taskId: string };
    expect(boardOf(ctx)[result.taskId]?.metadata).toEqual({ note: "kept" });
    await runForTest(findTool("updateTask"), { id: result.taskId, metadata: { ...forged, note: "again" } }, ctx);
    expect(boardOf(ctx)[result.taskId]?.metadata).toEqual({ note: "again" });
  });

  it("clears no real notice marker through updateTask's metadata", async () => {
    const owed = { attempt: 0, ending: "completed", due: 0 };
    const ctx = ctxWithTask("pending", { metadata: { "noticeOwed:0:completed": owed } });
    expect(await runForTest(findTool("updateTask"), { id: "a", metadata: { "noticeOwed:0:completed": null, note: "kept" } }, ctx)).toEqual({
      ok: true,
    });
    expect(boardOf(ctx).a?.metadata).toEqual({ "noticeOwed:0:completed": owed, note: "kept" });
  });

  it("files a task held when its start setting says so, and says it is held", async () => {
    const { ctx } = buildCtx();
    const result = (await runForTest(findTool("createTask"), { goal: "later", held: true, maxAttempts: 3 }, ctx)) as {
      ok: boolean;
      taskId: string;
      status?: string;
    };
    expect(result).toMatchObject({ ok: true, status: "held" });
    expect(boardOf(ctx)[result.taskId]).toMatchObject({ status: "held", maxAttempts: 3 });
  });

  it("answers no_delegation_board rather than throwing", async () => {
    const result = await runForTest(findTool("createTask"), { goal: "x" }, buildNoBoardCtx());
    expect(result).toEqual({ ok: false, error: "no_delegation_board" });
  });
});

describe("getTask", () => {
  // A coordinator asked "what did that task find?" answers from the task, not
  // from a line about it, so the read must carry what listTasks leaves out:
  // the whole result, the error, the question a parked task waits on (FIX-1972).
  it("returns a finished task's whole output, which listTasks leaves out", async () => {
    const found = { picked: "the retry helper", plan: ["merge the two copies", "delete the old one"] };
    const { ctx } = buildCtx({
      preTasks: {
        scan: { id: "scan", goal: "scan for tech debt", status: "completed", assignee: "eng.coder", attempts: 1, output: found, createdAt: Date.now(), updatedAt: Date.now() },
      },
    });
    const listed = (await runForTest(findTool("listTasks"), {}, ctx)) as { tasks: Array<Record<string, unknown>> };
    expect(listed.tasks[0]).not.toHaveProperty("output");
    const read = (await runForTest(findTool("getTask"), { id: "scan" }, ctx)) as { ok: boolean; task: Record<string, unknown> };
    expect(read.ok).toBe(true);
    expect(read.task).toMatchObject({ id: "scan", status: "completed", assignee: "eng.coder", output: found });
    expect(read.task).not.toHaveProperty("outputCut");
    expect(read.task).not.toHaveProperty("checkpoint");
  });

  it("shows a running task's checkpoint as its output, marked a checkpoint, with its status note", async () => {
    const { ctx } = buildCtx({
      preTasks: {
        run: { id: "run", goal: "draft", status: "in_progress", attempts: 1, output: "two sections", checkpointed: true, statusNote: "Drafting the summary", createdAt: Date.now(), updatedAt: Date.now() },
      },
    });
    const read = (await runForTest(findTool("getTask"), { id: "run" }, ctx)) as { task: Record<string, unknown> };
    expect(read.task).toMatchObject({ output: "two sections", checkpoint: true, statusNote: "Drafting the summary" });
  });

  it("cuts an output too long to return, and says so", async () => {
    const { ctx } = buildCtx({
      preTasks: {
        big: { id: "big", goal: "g", status: "completed", attempts: 1, output: "x".repeat(READ_OUTPUT_LIMIT + 10), createdAt: Date.now(), updatedAt: Date.now() },
      },
    });
    const read = (await runForTest(findTool("getTask"), { id: "big" }, ctx)) as { task: { output: string; outputCut?: true } };
    expect(read.task.output).toHaveLength(READ_OUTPUT_LIMIT);
    expect(read.task.outputCut).toBe(true);
  });

  it("cuts an input too long to return, the same way", async () => {
    const { ctx } = buildCtx({
      preTasks: {
        big: { id: "big", goal: "g", status: "pending", attempts: 0, input: { notes: "y".repeat(READ_OUTPUT_LIMIT) }, createdAt: Date.now(), updatedAt: Date.now() },
      },
    });
    const read = (await runForTest(findTool("getTask"), { id: "big" }, ctx)) as { task: { input: string; inputCut?: true } };
    expect(read.task.input).toHaveLength(READ_OUTPUT_LIMIT);
    expect(read.task.inputCut).toBe(true);
  });

  it("answers task_not_found for a task the board doesn't hold", async () => {
    const { ctx } = buildCtx();
    const read = await runForTest(findTool("getTask"), { id: "nope" }, ctx);
    expect(read).toEqual({ ok: false, error: "task_not_found", taskId: "nope" });
  });
});

describe("listTasks", () => {
  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    goal: id,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...extra,
  });

  it("returns the seeded board entries", async () => {
    const { ctx } = buildCtx({ preTasks: { a: row("a") } });
    const result = (await runForTest(findTool("listTasks"), {}, ctx)) as { ok: boolean; tasks: Array<{ id: string }> };
    expect(result.ok).toBe(true);
    expect(result.tasks.map((t) => t.id)).toEqual(["a"]);
  });

  it("names the run working each task, so a reader can open it, and nothing on a task no run has started", async () => {
    const run = { sessionId: "s-run", requestId: "r-run", attempt: 1 };
    const { ctx } = buildCtx({ preTasks: { a: row("a", { status: "in_progress", attempts: 1, run }), b: row("b") } });
    const result = (await runForTest(findTool("listTasks"), {}, ctx)) as { tasks: Array<{ id: string; run?: unknown }> };
    expect(result.tasks.find((t) => t.id === "a")?.run).toEqual(run);
    expect(result.tasks.find((t) => t.id === "b")).not.toHaveProperty("run");
  });

  it("filters to the tasks one task's request filed, and shows each one's status note, never its checkpoint", async () => {
    const { ctx } = buildCtx({
      preTasks: {
        p1: row("p1", { filedByTask: "parent", status: "in_progress", attempts: 1, statusNote: "Halfway", output: "a big checkpoint", checkpointed: true }),
        p2: row("p2", { filedByTask: "parent" }),
        other: row("other", { filedByTask: "elsewhere" }),
        loose: row("loose"),
      },
    });
    const result = (await runForTest(findTool("listTasks"), { filedByTask: "parent" }, ctx)) as {
      tasks: Array<Record<string, unknown>>;
    };
    expect(result.tasks.map((t) => t.id).sort()).toEqual(["p1", "p2"]);
    const p1 = result.tasks.find((t) => t.id === "p1")!;
    expect(p1).toMatchObject({ statusNote: "Halfway", filedByTask: "parent" });
    expect(p1).not.toHaveProperty("output");
  });

  it("answers no_delegation_board rather than throwing", async () => {
    const result = await runForTest(findTool("listTasks"), {}, buildNoBoardCtx());
    expect(result).toEqual({ ok: false, error: "no_delegation_board" });
  });
});

// ---------------------------------------------------------------------------
// updateTask: one rule per field (FIX-2081)
// ---------------------------------------------------------------------------

/** Each field updateTask edits, with a value that differs from the seeded row's. */
const EDITS: Array<[field: string, value: unknown]> = [
  ["goal", "a new goal"],
  ["title", "New title"],
  ["context", "new context"],
  ["input", { region: "eu" }],
  ["deps", ["b"]],
  ["priority", 9],
  ["labels", ["urgent"]],
  ["metadata", { audited: true }],
  ["assignee", "writer"],
  ["maxAttempts", 4],
];

/** The task's states, each as the row is seeded, and whether it has started. */
const STATES: Array<[name: string, seed: Record<string, unknown>, started: boolean]> = [
  ["pending", { status: "pending", attempts: 0 }, false],
  ["held", { status: "held", attempts: 0 }, false],
  ["pending after a retry", { status: "pending", attempts: 1, startedAt: 1 }, true],
  ["running", { status: "in_progress", attempts: 1, startedAt: 1 }, true],
  ["completed", { status: "completed", attempts: 1, startedAt: 1 }, true],
  ["errored", { status: "errored", attempts: 1, startedAt: 1 }, true],
  ["cancelled", { status: "cancelled", attempts: 0 }, false],
];

const FINISHED = new Set(["completed", "errored", "cancelled"]);

describe("updateTask — each field, in each state", () => {
  for (const [state, seed, started] of STATES) {
    const finished = FINISHED.has(state);
    for (const [field, value] of EDITS) {
      const allowed = !started && !finished;
      it(`${field} on a ${state} task is ${allowed ? "written" : "refused, naming the rule"}`, async () => {
        const ctx = ctxWithTask(seed.status as string, { ...seed, assignee: "researcher", priority: 1 });
        const before = structuredClone(boardOf(ctx).a);
        const result = (await runForTest(findTool("updateTask"), { id: "a", [field]: value }, ctx)) as {
          ok: boolean;
          error?: string;
        };
        if (allowed) {
          expect(result).toEqual({ ok: true });
          expect((boardOf(ctx).a as Record<string, unknown>)[field]).toEqual(value);
          return;
        }
        expect(result.ok).toBe(false);
        // The refusal names the field, the state and the rule.
        expect(result.error).toContain(field);
        expect(result.error).toContain(finished ? "task_finished" : "field_locked_after_start");
        expect(result.error).toContain(`task "a"`);
        expect(result.error).toContain("Nothing was written");
        expect(boardOf(ctx).a).toEqual(before);
      });
    }
  }

  it("a hold lands on a pending task and a release on a held one, before it starts", async () => {
    const ctx = ctxWithTask("pending");
    expect(await runForTest(findTool("updateTask"), { id: "a", status: "held" }, ctx)).toEqual({ ok: true });
    expect(boardOf(ctx).a?.status).toBe("held");
    expect(await runForTest(findTool("updateTask"), { id: "a", status: "pending" }, ctx)).toEqual({ ok: true });
    expect(boardOf(ctx).a?.status).toBe("pending");
  });

  it.each([
    ["running", "in_progress"],
    ["pending after a retry", "pending"],
  ])("a hold on a %s task is refused: it has started", async (_name, status) => {
    const ctx = ctxWithTask(status, { attempts: 1, startedAt: 1 });
    const result = (await runForTest(findTool("updateTask"), { id: "a", status: "held" }, ctx)) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("field_locked_after_start");
    expect(result.error).toContain("a hold or a release");
    expect(boardOf(ctx).a?.status).toBe(status);
  });

  it("a running task's reassign is refused, saying it keeps one accountable worker", async () => {
    const ctx = ctxWithTask("in_progress", { attempts: 1, startedAt: 1, assignee: "researcher" });
    const result = (await runForTest(findTool("updateTask"), { id: "a", assignee: "writer" }, ctx)) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("one accountable worker");
    expect(result.error).toContain("cancel it and file it again");
    expect(boardOf(ctx).a?.assignee).toBe("researcher");
  });

  it("labels replace the list whole", async () => {
    const ctx = ctxWithTask("pending", { labels: ["a", "b"] });
    await runForTest(findTool("updateTask"), { id: "a", labels: ["c"] }, ctx);
    expect(boardOf(ctx).a?.labels).toEqual(["c"]);
  });

  it("refuses an empty update, saying fields are flat", async () => {
    const ctx = ctxWithTask("pending");
    const result = (await runForTest(findTool("updateTask"), { id: "a" }, ctx)) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("nothing_to_update");
  });

  it("answers task_not_found for a task the board doesn't hold", async () => {
    const { ctx } = buildCtx();
    expect(await runForTest(findTool("updateTask"), { id: "ghost", priority: 1 }, ctx)).toMatchObject({
      ok: false,
      error: "task_not_found",
    });
  });
});

describe("updateTask — a cancel", () => {
  it.each([
    ["pending", { status: "pending", attempts: 0 }],
    ["held", { status: "held", attempts: 0 }],
    ["running", { status: "in_progress", attempts: 1, startedAt: 1 }],
  ])("lands on a %s task, until it finishes, and records it was a model's tool", async (_name, seed) => {
    const ctx = ctxWithTask(seed.status as string, seed);
    expect(await runForTest(findTool("updateTask"), { id: "a", status: "cancelled" }, ctx)).toEqual({ ok: true });
    expect(boardOf(ctx).a).toMatchObject({ status: "cancelled", cancelledVia: "tool" });
  });

  it.each(["completed", "errored", "cancelled"])("is refused on a %s task, which changes no more", async (status) => {
    const ctx = ctxWithTask(status, { attempts: 1 });
    const before = structuredClone(boardOf(ctx).a);
    const result = (await runForTest(findTool("updateTask"), { id: "a", status: "cancelled" }, ctx)) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("task_finished");
    expect(result.error).toContain("follow-up");
    expect(boardOf(ctx).a).toEqual(before);
  });

  it("is refused when it comes with an edit, and nothing is written", async () => {
    const ctx = ctxWithTask("pending", { priority: 1 });
    const result = (await runForTest(findTool("updateTask"), { id: "a", status: "cancelled", priority: 5 }, ctx)) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("cancel_takes_no_edits");
    expect(boardOf(ctx).a).toMatchObject({ status: "pending", priority: 1 });
  });

  // A model's own cancel owes no notice for it or for the dependents it takes
  // along (FIX-2078 D2), so the call's result is where it learns of them.
  it("names the dependents it cancelled", async () => {
    const now = Date.now();
    const ctx = buildCtx({
      preTasks: {
        a: { id: "a", goal: "x", status: "pending", attempts: 0, createdAt: now, updatedAt: now },
        b: { id: "b", goal: "y", status: "pending", attempts: 0, deps: ["a"], createdAt: now, updatedAt: now },
      },
    }).ctx;
    expect(await runForTest(findTool("updateTask"), { id: "a", status: "cancelled" }, ctx)).toEqual({ ok: true, cancelled: ["b"] });
  });

  it("names every dependent down the chain it took, not only the first level", async () => {
    const now = Date.now();
    const ctx = buildCtx({
      preTasks: {
        a: { id: "a", goal: "x", status: "pending", attempts: 0, createdAt: now, updatedAt: now },
        b: { id: "b", goal: "y", status: "pending", attempts: 0, deps: ["a"], createdAt: now, updatedAt: now },
        c: { id: "c", goal: "z", status: "pending", attempts: 0, deps: ["b"], createdAt: now, updatedAt: now },
      },
    }).ctx;
    const result = (await runForTest(findTool("updateTask"), { id: "a", status: "cancelled" }, ctx)) as { ok: boolean; cancelled?: string[] };
    expect(result.ok).toBe(true);
    expect([...(result.cancelled ?? [])].sort()).toEqual(["b", "c"]);
  });
});

/**
 * A release and a reassignment in one `updateTask` (FIX-2080): one guarded
 * write, so a refused reassignment can't leave the task released under the
 * worker it was meant to leave.
 */
describe("updateTask — a release with a reassignment", () => {
  it("leaves the task held when the reassignment is refused", async () => {
    // A follow-up keeps the worker of the task it follows.
    const ctx = ctxWithTask("held", { assignee: "researcher", followUpOf: "root" });
    const result = await runForTest(findTool("updateTask"), { id: "a", status: "pending", assignee: "writer" }, ctx);
    expect(result).toMatchObject({ ok: false, taskId: "a" });
    expect(boardOf(ctx).a).toMatchObject({ status: "held", assignee: "researcher" });
  });

  it("reassigns and releases when both are allowed", async () => {
    const ctx = ctxWithTask("held", { assignee: "researcher" });
    expect(await runForTest(findTool("updateTask"), { id: "a", status: "pending", assignee: "writer" }, ctx)).toEqual({ ok: true });
    expect(boardOf(ctx).a).toMatchObject({ status: "pending", assignee: "writer" });
  });

  it("doesn't release a task that wasn't held, so a claim landing mid-call isn't reported as a refusal", async () => {
    // Pending, never started: there is nothing to release. A worker claims it
    // right after the priority write lands.
    const ctx = ctxWithTask("pending", { assignee: "researcher", priority: 1 });
    const parent = (ctx as { parent: { state: Record<string, unknown>; atomicState: (fn: never) => Promise<void> } }).parent;
    const write = parent.atomicState.bind(parent);
    parent.atomicState = (async (fn: never) => {
      await write(fn);
      const board = parent.state[BOARD_FIELD] as Record<string, Record<string, unknown>>;
      if (board.a!.priority === 9) board.a = { ...board.a, status: "in_progress", attempts: 1, startedAt: Date.now() };
    }) as typeof parent.atomicState;

    const result = await runForTest(findTool("updateTask"), { id: "a", status: "pending", priority: 9 }, ctx);

    expect(result).toEqual({ ok: true });
    expect(boardOf(ctx).a).toMatchObject({ status: "in_progress", priority: 9 });
  });

  it("writes nothing when the release is refused: a retried task has started", async () => {
    // A release, a reassignment and a priority in one call: the refusal
    // leaves every field as it was, not just the status.
    const ctx = ctxWithTask("pending", { assignee: "researcher", attempts: 1, priority: 1 });

    const result = await runForTest(findTool("updateTask"), { id: "a", status: "pending", assignee: "writer", priority: 9 }, ctx);

    expect(result).toMatchObject({ ok: false, taskId: "a" });
    expect((result as { error: string }).error).toContain("field_locked_after_start");
    expect((result as { error: string }).error).toContain("Nothing was written.");
    expect(boardOf(ctx).a).toMatchObject({ status: "pending", assignee: "researcher", priority: 1 });
  });

  it("releases a legacy blocked row that already ran, but edits nothing on it", async () => {
    // BP-030: a row stored `blocked` after a retry reads as held with attempts
    // spent, marked `heldFromBlocked` by the read boundary. A release alone is
    // how it runs again; any edit is still locked.
    const ctx = ctxWithTask("held", { attempts: 1, assignee: "researcher", heldFromBlocked: true });
    const edit = (await runForTest(findTool("updateTask"), { id: "a", status: "pending", assignee: "writer" }, ctx)) as { ok: boolean; error: string };
    expect(edit.ok).toBe(false);
    expect(edit.error).toContain("field_locked_after_start");
    expect(boardOf(ctx).a).toMatchObject({ status: "held", assignee: "researcher" });
    expect(await runForTest(findTool("updateTask"), { id: "a", status: "pending" }, ctx)).toEqual({ ok: true });
    expect(boardOf(ctx).a).toMatchObject({ status: "pending", assignee: "researcher" });
    // The mark serves that one release: a later hold is an ordinary one.
    expect((boardOf(ctx).a as Record<string, unknown>).heldFromBlocked).toBeUndefined();
  });

  it("refuses to release a started held row that isn't a legacy blocked one", async () => {
    // No current path holds a started row; if one ever appears, the field
    // table's rule for a hold or release holds: until the task first starts.
    const ctx = ctxWithTask("held", { attempts: 1, assignee: "researcher" });
    const released = (await runForTest(findTool("updateTask"), { id: "a", status: "pending" }, ctx)) as { ok: boolean; error: string };
    expect(released.ok).toBe(false);
    expect(released.error).toContain("field_locked_after_start");
    expect(boardOf(ctx).a).toMatchObject({ status: "held" });
  });
});

// ---------------------------------------------------------------------------
// Assignee validation (FIX-924)
// ---------------------------------------------------------------------------

/** A two-worker roster standing in for a board's declared workers. */
const testRoster: AssigneeRoster = {
  has: (a) => a === "researcher" || a === "writer",
  describe: () => "researcher (Researches sources), writer (Drafts prose)",
};

/** The roster-carrying tools, as a caller supplying a roster builds them. */
function rosterTool(name: string): GeneratorTool {
  const tool = buildTaskToolsList(ownStateResolver, testRoster).find(
    (t) => (t as { config?: { name?: string } }).config?.name === name,
  );
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool as GeneratorTool;
}

describe("checkAssignee — the single assignment gate", () => {
  it("accepts an assignee that names a declared agent", () => {
    expect(checkAssignee("researcher", testRoster)).toBeUndefined();
  });

  it("accepts an absent assignee, so the default worker stays reachable by intent", () => {
    expect(checkAssignee(undefined, testRoster)).toBeUndefined();
  });

  it("is inert with no roster, so a roster-less consumer behaves as before", () => {
    expect(checkAssignee("anyone-at-all", undefined)).toBeUndefined();
  });

  it("rejects an unknown assignee, naming it and the agents that do exist", () => {
    const result = checkAssignee("reseacher", testRoster);
    expect(result?.ok).toBe(false);
    expect(result?.error).toContain("unknown_assignee");
    expect(result?.error).toContain('"reseacher"');
    expect(result?.error).toContain("researcher (Researches sources)");
    expect(result?.error).toContain("writer (Drafts prose)");
  });

  it("matches exactly — a case variant of a real agent is still unknown", () => {
    expect(checkAssignee("Researcher", testRoster)?.ok).toBe(false);
  });
});

describe("taskTools — assignee validation with a roster", () => {
  it("createTask rejects a typo'd assignee and creates no task", async () => {
    const { ctx } = buildCtx();
    const result = (await runForTest(rosterTool("createTask"), { goal: "Find sources", assignee: "reseacher" }, ctx)) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("unknown_assignee");
    expect(Object.keys(boardOf(ctx))).toEqual([]);
  });

  it("createTask accepts a declared agent", async () => {
    const { ctx } = buildCtx();
    const result = (await runForTest(rosterTool("createTask"), { goal: "Find sources", assignee: "researcher" }, ctx)) as {
      ok: boolean;
    };
    expect(result.ok).toBe(true);
    expect(Object.values(boardOf(ctx))[0]?.assignee).toBe("researcher");
  });

  it("updateTask rejects an unknown assignee before the task starts", async () => {
    const ctx = ctxWithTask("pending", { assignee: "researcher" });
    const result = (await runForTest(rosterTool("updateTask"), { id: "a", assignee: "nobody" }, ctx)) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("unknown_assignee");
    expect(boardOf(ctx).a?.assignee).toBe("researcher");
  });

  it("updateTask leaves the gate inert for an edit that doesn't touch assignee", async () => {
    const ctx = ctxWithTask("pending", { assignee: "researcher" });
    expect(await runForTest(rosterTool("updateTask"), { id: "a", priority: 5 }, ctx)).toEqual({ ok: true });
  });
});

describe("taskTools — no roster supplied (back-compat)", () => {
  it("createTask accepts any assignee, exactly as before roster validation", async () => {
    const { ctx } = buildCtx();
    const result = (await runForTest(findTool("createTask"), { goal: "x", assignee: "whoever" }, ctx)) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(Object.values(boardOf(ctx))[0]?.assignee).toBe("whoever");
  });
});

/**
 * The soft set is a named list of error classes; a scope-mutation failure is
 * not on it and must still reach the caller as a throw rather than becoming a
 * polite result the model narrates past.
 */
describe("taskTools — other failures still propagate", () => {
  it("lets a scope-mutation failure escape instead of returning it as a result", async () => {
    const ctx = ctxWithTask("pending");
    (ctx as unknown as { parent: { atomicState: unknown } }).parent.atomicState = async () => {
      throw new Error("scope mutation timed out");
    };
    await expect(runForTest(findTool("updateTask"), { id: "a", priority: 2 }, ctx)).rejects.toThrow("scope mutation timed out");
  });
});
