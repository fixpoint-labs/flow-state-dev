import { describe, expect, it } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import { z } from "zod";
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

describe("taskTools capability", () => {
  it("registers nine tools under the default preset", () => {
    const presetDefs = (taskTools as unknown as {
      __presetDefs?: { tools?: { controlTools?: unknown } };
    }).__presetDefs;
    const names = resolvedControlTools(presetDefs?.tools?.controlTools).map((t) => t.config?.name).sort();
    expect(names).toEqual([
      "addTask",
      "answerTask",
      "assignTask",
      "cancelTask",
      "completeTask",
      "failTask",
      "listTasks",
      "readTask",
      "updateTask",
    ]);
  });

  it("createTaskToolsCapability returns a freshly composable capability", () => {
    const cap = createTaskToolsCapability(ownStateResolver);
    expect(cap.name).toBe("taskTools");
  });

  it("addTask documents both creation caps it can return", () => {
    // `addTask` genuinely returns these two errors when the board it resolves
    // has ceilings, and the model needs to recognize them to react.
    const description = findTool("addTask").config?.description ?? "";
    expect(description).toContain("enqueued_task_cap_exceeded");
    expect(description).toContain("total_task_cap_exceeded");
  });
});

describe("taskTools — happy paths (own-state board)", () => {
  it("addTask creates a task on the delegation board", async () => {
    const { ctx } = buildCtx();
    const result = await runForTest(findTool("addTask"), { goal: "write report" }, ctx);
    expect((result as { ok: boolean }).ok).toBe(true);
    expect((result as { taskId: string }).taskId).toMatch(/^task_/);
  });

  // A notice marker decides what the filer hears; only an ending's write sets
  // one, so a caller's metadata can't forge one (BP-031, FIX-2078).
  it("addTask files no notice marker a caller's metadata names", async () => {
    const { ctx } = buildCtx();
    const result = await runForTest(
      findTool("addTask"),
      {
        goal: "forged",
        metadata: {
          "noticeOwed:0:completed": { attempt: 0, ending: "completed", due: 0 },
          "noticeUndeliverable:0:completed": { at: 0, detail: "x" },
          note: "kept",
        },
      },
      ctx,
    );
    const taskId = (result as { taskId: string }).taskId;
    const board = (ctx as { parent: { state: Record<string, unknown> } }).parent.state[BOARD_FIELD] as Record<string, { metadata?: unknown }>;
    expect(board[taskId]?.metadata).toEqual({ note: "kept" });
  });

  it("addTask stores a structured input payload on the task", async () => {
    const { ctx } = buildCtx();
    const result = await runForTest(
      findTool("addTask"),
      { goal: "analyze", assignee: "analyst", input: { subject: "ACME" } },
      ctx,
    );
    expect((result as { ok: boolean }).ok).toBe(true);
    const taskId = (result as { taskId: string }).taskId;
    const board = (
      (ctx as { parent: { state: Record<string, unknown> } }).parent.state[
        BOARD_FIELD
      ] as Record<string, { input?: unknown }>
    );
    expect(board[taskId]?.input).toEqual({ subject: "ACME" });
  });

  // A coordinator asked "what did that task find?" answers from the task, not
  // from a line about it, so the read must carry what listTasks leaves out:
  // the whole result, the error, the question a parked task waits on (FIX-1972).
  it("readTask returns a finished task's whole result, which listTasks leaves out", async () => {
    const found = { picked: "the retry helper", plan: ["merge the two copies", "delete the old one"] };
    const { ctx } = buildCtx({
      preTasks: {
        scan: {
          id: "scan",
          goal: "scan for tech debt",
          status: "completed",
          assignee: "eng.coder",
          attempts: 1,
          output: found,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    });
    const listed = (await runForTest(findTool("listTasks"), {}, ctx)) as { tasks: Array<Record<string, unknown>> };
    expect(listed.tasks[0]).not.toHaveProperty("output");
    const read = (await runForTest(findTool("readTask"), { taskId: "scan" }, ctx)) as {
      ok: boolean;
      task: Record<string, unknown>;
    };
    expect(read.ok).toBe(true);
    expect(read.task).toMatchObject({ id: "scan", status: "completed", assignee: "eng.coder", output: found });
    expect(read.task).not.toHaveProperty("outputCut");
  });

  it("readTask names the question a task is parked on, and only a question park", async () => {
    const parked = { goal: "propose a plan", status: "parked", attempts: 1, createdAt: Date.now(), updatedAt: Date.now() };
    const { ctx } = buildCtx({
      preTasks: {
        asks: { ...parked, id: "asks", parkedOnQuestion: true, feedback: "Approve the plan?" },
        held: { ...parked, id: "held", feedback: "a person's turn" },
      },
    });
    const asks = (await runForTest(findTool("readTask"), { taskId: "asks" }, ctx)) as { task: Record<string, unknown> };
    expect(asks.task.question).toBe("Approve the plan?");
    const held = (await runForTest(findTool("readTask"), { taskId: "held" }, ctx)) as { task: Record<string, unknown> };
    expect(held.task).not.toHaveProperty("question");
  });

  it("readTask cuts a result too long to return, and says so", async () => {
    const { ctx } = buildCtx({
      preTasks: {
        big: { id: "big", goal: "g", status: "completed", attempts: 1, output: "x".repeat(READ_OUTPUT_LIMIT + 10), createdAt: Date.now(), updatedAt: Date.now() },
      },
    });
    const read = (await runForTest(findTool("readTask"), { taskId: "big" }, ctx)) as { task: { output: string; outputCut?: true } };
    expect(read.task.output).toHaveLength(READ_OUTPUT_LIMIT);
    expect(read.task.outputCut).toBe(true);
  });

  it("readTask cuts an input too long to return, the same way", async () => {
    const { ctx } = buildCtx({
      preTasks: {
        big: { id: "big", goal: "g", status: "pending", attempts: 0, input: { notes: "y".repeat(READ_OUTPUT_LIMIT) }, createdAt: Date.now(), updatedAt: Date.now() },
      },
    });
    const read = (await runForTest(findTool("readTask"), { taskId: "big" }, ctx)) as { task: { input: string; inputCut?: true } };
    expect(read.task.input).toHaveLength(READ_OUTPUT_LIMIT);
    expect(read.task.inputCut).toBe(true);
  });

  it("readTask answers task_not_found for a task the board doesn't hold", async () => {
    const { ctx } = buildCtx();
    const read = await runForTest(findTool("readTask"), { taskId: "nope" }, ctx);
    expect(read).toEqual({ ok: false, error: "task_not_found", taskId: "nope" });
  });

  it("listTasks returns the seeded board entries", async () => {
    const { ctx } = buildCtx({
      preTasks: {
        a: {
          id: "a",
          goal: "first",
          status: "pending",
          attempts: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    });
    const result = await runForTest(findTool("listTasks"), {}, ctx);
    expect((result as { ok: boolean }).ok).toBe(true);
    expect((result as { tasks: Array<{ id: string }> }).tasks.map((t) => t.id)).toEqual(["a"]);
  });

  it("listTasks names the run working each task, so a reader can open it, and nothing on a task no run has started", async () => {
    const run = { sessionId: "s-run", requestId: "r-run", attempt: 1 };
    const { ctx } = buildCtx({
      preTasks: {
        a: { id: "a", goal: "running", status: "in_progress", attempts: 1, run, createdAt: Date.now(), updatedAt: Date.now() },
        b: { id: "b", goal: "waiting", status: "pending", attempts: 0, createdAt: Date.now(), updatedAt: Date.now() },
      },
    });
    const result = (await runForTest(findTool("listTasks"), {}, ctx)) as {
      tasks: Array<{ id: string; run?: unknown }>;
    };
    expect(result.tasks.find((t) => t.id === "a")?.run).toEqual(run);
    expect(result.tasks.find((t) => t.id === "b")).not.toHaveProperty("run");
  });

  // Named for what it seeds. It has always seeded `in_progress`; the old name
  // said `pending`, which is the one status completeTask is REFUSED from.
  it("completeTask transitions an in_progress task to completed", async () => {
    const { ctx } = buildCtx({
      preTasks: {
        a: {
          id: "a",
          goal: "x",
          status: "in_progress",
          attempts: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    });
    const result = await runForTest(
      findTool("completeTask"),
      { taskId: "a", output: "done" },
      ctx,
    );
    expect((result as { ok: boolean }).ok).toBe(true);
  });
});

describe("taskTools — no delegation board", () => {
  it("addTask returns the no_delegation_board error rather than throwing", async () => {
    const ctx = buildNoBoardCtx();
    const result = await runForTest(findTool("addTask"), { goal: "x" }, ctx);
    expect(result).toEqual({ ok: false, error: "no_delegation_board" });
  });

  it("listTasks returns the no_delegation_board error rather than throwing", async () => {
    const ctx = buildNoBoardCtx();
    const result = await runForTest(findTool("listTasks"), {}, ctx);
    expect(result).toEqual({ ok: false, error: "no_delegation_board" });
  });
});

describe("taskTools — unknown task ids", () => {
  it("completeTask returns task_not_found for an unknown id", async () => {
    const { ctx } = buildCtx();
    const result = await runForTest(
      findTool("completeTask"),
      { taskId: "ghost", output: null },
      ctx,
    );
    expect(result).toEqual({
      ok: false,
      error: "task_not_found",
      taskId: "ghost",
    });
  });
});

// ---------------------------------------------------------------------------
// Assignee validation (FIX-924)
// ---------------------------------------------------------------------------

/**
 * A two-worker roster standing in for a board's declared workers.
 */
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

/** Read the live board record off a mock ctx. */
function boardOf(ctx: unknown): Record<string, { assignee?: string }> {
  return (ctx as { parent: { state: Record<string, unknown> } }).parent.state[
    BOARD_FIELD
  ] as Record<string, { assignee?: string }>;
}

const seededTask = (assignee?: string) => ({
  a: {
    id: "a",
    goal: "x",
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...(assignee !== undefined ? { assignee } : {}),
  },
});

describe("checkAssignee — the single assignment gate", () => {
  it("accepts an assignee that names a declared agent", () => {
    expect(checkAssignee("researcher", testRoster)).toBeUndefined();
  });

  it("accepts an absent assignee, so the default worker stays reachable by intent", () => {
    // A board's default worker is reached by deliberately omitting the
    // assignee. Closing that would break it, not just typos.
    expect(checkAssignee(undefined, testRoster)).toBeUndefined();
  });

  it("is inert with no roster, so a roster-less consumer behaves as before", () => {
    expect(checkAssignee("anyone-at-all", undefined)).toBeUndefined();
  });

  it("rejects an unknown assignee, naming it and the agents that do exist", () => {
    const result = checkAssignee("reseacher", testRoster);
    // The message has to carry both halves or the model can't self-correct:
    // what it got wrong, and what it could have said instead.
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
  it("addTask rejects a typo'd assignee and creates no task", async () => {
    const { ctx } = buildCtx();
    const result = await runForTest(
      rosterTool("addTask"),
      { goal: "Find sources", assignee: "reseacher" },
      ctx,
    );
    expect((result as { ok: boolean }).ok).toBe(false);
    expect((result as { error: string }).error).toContain("unknown_assignee");
    // The whole point of failing at creation: no phantom task is left behind
    // to blow up later when the board drains.
    expect(Object.keys(boardOf(ctx))).toEqual([]);
  });

  it("addTask accepts a declared agent", async () => {
    const { ctx } = buildCtx();
    const result = await runForTest(
      rosterTool("addTask"),
      { goal: "Find sources", assignee: "researcher" },
      ctx,
    );
    expect((result as { ok: boolean }).ok).toBe(true);
    expect(Object.values(boardOf(ctx))[0]?.assignee).toBe("researcher");
  });

  it("addTask accepts an unassigned task even with a roster (it runs on the floor)", async () => {
    const { ctx } = buildCtx();
    const result = await runForTest(rosterTool("addTask"), { goal: "anything" }, ctx);
    expect((result as { ok: boolean }).ok).toBe(true);
  });

  it("assignTask rejects an unknown assignee and leaves the task's assignee unchanged", async () => {
    const { ctx } = buildCtx({ preTasks: seededTask("researcher") });
    const result = await runForTest(
      rosterTool("assignTask"),
      { taskId: "a", assignee: "ghostwriter" },
      ctx,
    );
    expect((result as { ok: boolean }).ok).toBe(false);
    expect(boardOf(ctx).a?.assignee).toBe("researcher");
  });

  it("assignTask reports an unknown TASK before an unknown assignee", async () => {
    // Both are wrong; the missing task is the more fundamental error and the
    // one the model must fix first.
    const { ctx } = buildCtx();
    const result = await runForTest(
      rosterTool("assignTask"),
      { taskId: "ghost", assignee: "nobody" },
      ctx,
    );
    expect((result as { error: string }).error).toBe("task_not_found");
  });

  it("updateTask rejects an unknown assignee in the patch", async () => {
    const { ctx } = buildCtx({ preTasks: seededTask("researcher") });
    const result = await runForTest(
      rosterTool("updateTask"),
      { taskId: "a", patch: { assignee: "nobody" } },
      ctx,
    );
    expect((result as { ok: boolean }).ok).toBe(false);
    expect((result as { error: string }).error).toContain("unknown_assignee");
    expect(boardOf(ctx).a?.assignee).toBe("researcher");
  });

  it("updateTask leaves the gate inert for a patch that doesn't touch assignee", async () => {
    const { ctx } = buildCtx({ preTasks: seededTask("researcher") });
    const result = await runForTest(
      rosterTool("updateTask"),
      { taskId: "a", patch: { priority: 5 } },
      ctx,
    );
    expect((result as { ok: boolean }).ok).toBe(true);
  });
});

describe("taskTools — no roster supplied (back-compat)", () => {
  it("addTask accepts any assignee, exactly as before roster validation", async () => {
    // A capability built without a roster knows no workers, so it has nothing
    // to validate against and must not start rejecting (BP-030).
    const { ctx } = buildCtx();
    const result = await runForTest(
      findTool("addTask"),
      { goal: "x", assignee: "whoever" },
      ctx,
    );
    expect((result as { ok: boolean }).ok).toBe(true);
    expect(Object.values(boardOf(ctx))[0]?.assignee).toBe("whoever");
  });

  it("assignTask accepts any assignee", async () => {
    const { ctx } = buildCtx({ preTasks: seededTask() });
    const result = await runForTest(
      findTool("assignTask"),
      { taskId: "a", assignee: "whoever" },
      ctx,
    );
    expect((result as { ok: boolean }).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Illegal status transitions (FIX-950)
// ---------------------------------------------------------------------------

/** Seed a board holding exactly one task in `status`, plus any extra fields. */
function ctxWithTask(status: string, extra: Record<string, unknown> = {}) {
  return buildCtx({
    preTasks: {
      a: {
        id: "a",
        goal: "x",
        status,
        attempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...extra,
      },
    },
  }).ctx;
}

/** The seeded task's status as it stands on the board now. */
function statusOfA(ctx: unknown): string {
  const board = (ctx as { parent: { state: Record<string, unknown> } }).parent.state[
    BOARD_FIELD
  ] as Record<string, { status: string }>;
  return board.a!.status;
}

/** Drive a tool and return the `error` string it reported. */
async function errorFrom(tool: string, input: Record<string, unknown>, ctx: unknown) {
  const result = await runForTest(findTool(tool), input, ctx as never);
  expect((result as { ok: boolean }).ok).toBe(false);
  return (result as { error: string }).error;
}

/**
 * Each of the three tools that could refuse a transition answers with the
 * shared recoverable shape, and leaves the task exactly as it found it.
 */
describe("taskTools — illegal status transitions return a recoverable result", () => {
  it("completeTask on a pending task reports not-ok instead of throwing", async () => {
    const ctx = ctxWithTask("pending");
    const result = await runForTest(findTool("completeTask"), { taskId: "a", output: "done" }, ctx);
    expect(result).toMatchObject({ ok: false, taskId: "a" });
    expect((result as { error: string }).error).toContain("illegal_status_transition");
    expect(statusOfA(ctx)).toBe("pending");
  });

  it("failTask on a pending task reports not-ok instead of throwing", async () => {
    const ctx = ctxWithTask("pending");
    const result = await runForTest(findTool("failTask"), { taskId: "a", error: "nope" }, ctx);
    expect(result).toMatchObject({ ok: false, taskId: "a" });
    expect((result as { error: string }).error).toContain("illegal_status_transition");
    expect(statusOfA(ctx)).toBe("pending");
  });
});

/**
 * The recovery half. These are the cases where a list derived from
 * `allowedTransitionsFrom` (a fact about the COLLECTION) and one derived from
 * tool-reachable actions (a fact about the TOOL surface, where the model
 * stands) give different answers.
 */
describe("taskTools — the recovery list names tool-reachable calls", () => {
  it("names the calls available from pending, and does not name a status no tool reaches", async () => {
    const error = await errorFrom(
      "completeTask",
      { taskId: "a", output: "done" },
      ctxWithTask("pending"),
    );
    expect(error).toContain('task "a" is pending');
    expect(error).toContain("transitioning to completed is not available");
    // `allowedTransitionsFrom("pending")` includes `in_progress`, which no task
    // tool can reach — a worker claim during a drain is the only route there.
    expect(error).not.toContain("in_progress");
    expect(error).toContain("From here you can call cancelTask.");
    // The rejected tool excludes itself: its target is by definition not allowed.
    expect(error).not.toContain("completeTask");
    // Said without asserting HOW a task gets started — this surface does not
    // know whether its consumer has a drain tool.
    expect(error).toContain("has not been started yet");
  });

  it("names only cancelTask for a held task: no failure reaches a task that never started", async () => {
    const error = await errorFrom(
      "completeTask",
      { taskId: "a", output: "done" },
      ctxWithTask("held"),
    );
    expect(error).toContain('task "a" is held');
    // `allowedTransitionsFrom("held")` claims `pending`, which no
    // status-changing tool reaches (a failure on a held task is refused,
    // FIX-2080). The message must not suggest otherwise.
    expect(error).not.toContain("pending");
    expect(error).toContain("From here you can call cancelTask.");
    expect(error).not.toContain("failTask");
  });

  it("states a terminal task as terminal, without rendering an empty action list", async () => {
    const error = await errorFrom(
      "failTask",
      { taskId: "a", error: "late" },
      ctxWithTask("completed"),
    );
    expect(error).toContain('task "a" is completed, which is terminal');
    expect(error).toContain("Add a new task instead");
    // No dangling "From here you can call ." and no claim that nothing at all
    // can be called. (`cancelTask` on a terminal task is now also refused, and
    // says so in the same shape — see the declined-write suite below.)
    expect(error).not.toContain("From here you can call");
    expect(error).not.toMatch(/nothing/i);
    // Terminal messages quote no target status; that is what keeps `failTask`'s
    // retry-branch target from ever being rendered as the model's intent.
    expect(error).not.toContain("transitioning to");
  });

  it("renders a non-empty action list from every non-terminal status", async () => {
    // The composer has no empty-list branch, on the strength of a table
    // invariant: every non-terminal row of ALLOWED_TRANSITIONS contains
    // `cancelled`, and `cancelTask` targets it. That invariant lives in
    // task-status.ts, not here, so a future edit to the table (adding a status,
    // or narrowing a row) could break this file's output with nothing in it
    // changing. Asserted here rather than guarded at runtime — an unreachable
    // `if` would hide the regression, and this names it instead.
    // From `in_progress` and `parked` every status tool is legal, so no call
    // there is refused and there is nothing to render.
    const probes: Array<[status: string, tool: string]> = [
      ["pending", "completeTask"],
      ["held", "completeTask"],
    ];
    for (const [status, tool] of probes) {
      const error = await errorFrom(tool, { taskId: "a", reason: "r" }, ctxWithTask(status));
      const clause = /From here you can call (.+)\.$/.exec(error.trim());
      expect(clause, `${tool} from ${status} advertised no calls`).not.toBeNull();
      expect(clause![1]!.trim()).not.toBe("");
      expect(clause![1]).not.toContain("undefined");
    }
  });
});

/**
 * `failTask`'s target is conditional on the task's retry budget, so the composer
 * asks `shouldRetryOnFail` about the task in hand rather than assuming.
 *
 * Note the layer: these tasks are seeded with `maxAttempts` directly onto the
 * board. The `addTask` TOOL exposes no `maxAttempts`, so tasks
 * created through it never carry a budget — but `taskTools` /
 * `buildTaskToolsList` are exported standalone and can be wired onto a
 * collection whose tasks do (the task-board primitive stamps one via
 * `applyReplan`'s `maxAttemptsPerTask`). The composer is surface-agnostic by
 * construction; these cases cover the wiring where the branch is live.
 */
describe("taskTools — failTask's retry budget", () => {
  it("succeeds on a pending task that still has retry budget", async () => {
    const ctx = ctxWithTask("pending", { maxAttempts: 3, attempts: 1 });
    const result = await runForTest(findTool("failTask"), { taskId: "a", error: "flaky" }, ctx);
    expect((result as { ok: boolean }).ok).toBe(true);
    // Same-status, but not inert: it soft-fails back to pending and records the
    // error as feedback for the next attempt.
    expect(statusOfA(ctx)).toBe("pending");
  });

  it("advertises failTask from pending when the task has retry budget", async () => {
    // Asserted SEPARATELY from the success case above on purpose. A same-status
    // filter in the composer would leave the call succeeding while silently
    // dropping it from the recovery list, and only this assertion catches that.
    const error = await errorFrom(
      "completeTask",
      { taskId: "a", output: "done" },
      ctxWithTask("pending", { maxAttempts: 3, attempts: 1 }),
    );
    expect(error).toContain("failTask");
  });

  it("omits failTask from pending when the task has no retry budget", async () => {
    const error = await errorFrom(
      "completeTask",
      { taskId: "a", output: "done" },
      ctxWithTask("pending"),
    );
    expect(error).not.toContain("failTask");
  });
});

// ---------------------------------------------------------------------------
// Declined writes on a terminal task (FIX-976)
// ---------------------------------------------------------------------------

/** Read the seeded task's mutable fields off a mock ctx. */
function taskA(ctx: unknown) {
  return (
    (ctx as { parent: { state: Record<string, unknown> } }).parent.state[
      BOARD_FIELD
    ] as Record<
      string,
      { assignee?: string; priority?: number; labels?: string[]; metadata?: unknown }
    >
  ).a;
}

/**
 * The defect this issue is about. Against a task that already finished, three of
 * these tools used to give three different answers and only one was true:
 * `failTask` refused honestly, `cancelTask` said it worked and did nothing, and
 * `assignTask` said it worked and wrote the new assignee onto a dead task.
 */
describe("taskTools — writes to a terminal task are refused, not silently accepted", () => {
  it.each(["completed", "errored", "cancelled"] as const)(
    "assignTask on a %s task refuses and does not rewrite the assignee",
    async (status) => {
      const ctx = ctxWithTask(status, { assignee: "researcher" });

      const result = await runForTest(
        findTool("assignTask"),
        { taskId: "a", assignee: "backup-researcher" },
        ctx,
      );

      expect(result).toMatchObject({ ok: false, taskId: "a" });
      const error = (result as { error: string }).error;
      expect(error).toContain("terminal_task_write_declined");
      expect(error).toContain(`task "a" is ${status}, which is terminal`);
      // Names what the caller actually attempted. `failTask`'s copy says "its
      // status will not change again", which would be the wrong thing here —
      // `assignTask` attempts no status transition.
      expect(error).toContain("Its assignee will not change.");
      expect(error).not.toContain("Its status will not change");
      expect(error).toContain("Add a new task instead");
      // The heart of it: the write did not land.
      expect(taskA(ctx)?.assignee).toBe("researcher");
    },
  );

  it("cancelTask on a terminal task refuses instead of reporting a phantom success", async () => {
    const ctx = ctxWithTask("errored");

    const result = await runForTest(findTool("cancelTask"), { taskId: "a", reason: "obsolete" }, ctx);

    expect(result).toMatchObject({ ok: false, taskId: "a" });
    const error = (result as { error: string }).error;
    expect(error).toContain("terminal_task_write_declined");
    expect(error).toContain('task "a" is errored, which is terminal');
    // A cancel WOULD have changed the status, so this one names the status.
    expect(error).toContain("Its status will not change again.");
    expect(statusOfA(ctx)).toBe("errored");
  });

  it("reads the same as failTask's refusal on the same task, bar the code and the clause", async () => {
    // Decision 6: one parameterized renderer, not four bespoke messages. The
    // sentence shape and the closing suggestion have to match, or the four tools
    // drift into four ways of saying the same thing.
    const completed = await errorFrom("failTask", { taskId: "a", error: "late" }, ctxWithTask("completed"));
    const cancelled = await errorFrom("cancelTask", { taskId: "a" }, ctxWithTask("completed"));

    const shape = (error: string) => error.replace(/^[a-z_]+:/, "CODE:");
    expect(shape(cancelled)).toBe(shape(completed));
  });

  it("cancelTask still succeeds on a live task", async () => {
    // The control. The refusal must not touch the case it is not for.
    const ctx = ctxWithTask("pending");
    const result = await runForTest(findTool("cancelTask"), { taskId: "a" }, ctx);
    expect(result).toEqual({ ok: true });
    expect(statusOfA(ctx)).toBe("cancelled");
  });

  // A model's own cancel owes no notice for it or for the dependents it takes
  // along (FIX-2078 D2), so the call's result is where it learns of them.
  it("cancelTask names the dependents its cancel cancelled", async () => {
    const now = Date.now();
    const ctx = buildCtx({
      preTasks: {
        a: { id: "a", goal: "x", status: "pending", attempts: 0, createdAt: now, updatedAt: now },
        b: { id: "b", goal: "y", status: "pending", attempts: 0, deps: ["a"], createdAt: now, updatedAt: now },
      },
    }).ctx;
    const result = await runForTest(findTool("cancelTask"), { taskId: "a" }, ctx);
    expect(result).toEqual({ ok: true, cancelled: ["b"] });
  });

  it("cancelTask names every dependent down the chain its cancel took, not only the first level", async () => {
    const now = Date.now();
    const ctx = buildCtx({
      preTasks: {
        a: { id: "a", goal: "x", status: "pending", attempts: 0, createdAt: now, updatedAt: now },
        b: { id: "b", goal: "y", status: "pending", attempts: 0, deps: ["a"], createdAt: now, updatedAt: now },
        c: { id: "c", goal: "z", status: "pending", attempts: 0, deps: ["b"], createdAt: now, updatedAt: now },
      },
    }).ctx;
    const result = (await runForTest(findTool("cancelTask"), { taskId: "a" }, ctx)) as { ok: boolean; cancelled?: string[] };
    expect(result.ok).toBe(true);
    expect([...(result.cancelled ?? [])].sort()).toEqual(["b", "c"]);
  });

  it("assignTask still succeeds on a live task", async () => {
    const ctx = ctxWithTask("pending", { assignee: "researcher" });
    const result = await runForTest(
      findTool("assignTask"),
      { taskId: "a", assignee: "writer" },
      ctx,
    );
    expect(result).toEqual({ ok: true });
    expect(taskA(ctx)?.assignee).toBe("writer");
  });
});

/**
 * `updateTask` runs the one guardable write first and short-circuits (Decision
 * 4). Under the assignment-only guard exactly one of its five writes can
 * decline, which is what makes a single verdict honest in both directions.
 */
describe("taskTools — updateTask with an assignee on a terminal task", () => {
  it("refuses and mutates nothing else — priority, metadata and labels all untouched", async () => {
    const ctx = ctxWithTask("completed", { assignee: "researcher", priority: 1 });

    const result = await runForTest(
      findTool("updateTask"),
      {
        taskId: "a",
        patch: {
          assignee: "writer",
          priority: 9,
          metadata: { audited: true },
          addLabel: "late",
        },
      },
      ctx,
    );

    expect(result).toMatchObject({ ok: false, taskId: "a" });
    expect((result as { error: string }).error).toContain("terminal_task_write_declined");
    // The short-circuit. Ordering the guarded write first is what makes the
    // single boolean true in both directions: nothing else ever ran.
    const task = taskA(ctx);
    expect(task?.assignee).toBe("researcher");
    expect(task?.priority).toBe(1);
    expect(task?.metadata).toBeUndefined();
    expect(task?.labels).toBeUndefined();
  });

  it("neither forges a notice marker nor clears a real one through the metadata patch (BP-031, FIX-2078)", async () => {
    const owed = { attempt: 1, ending: "completed", due: 0 };
    const ctx = ctxWithTask("completed", { attempts: 1, metadata: { "noticeOwed:1:completed": owed } });
    const result = await runForTest(
      findTool("updateTask"),
      {
        taskId: "a",
        patch: {
          metadata: {
            "noticeOwed:1:completed": null,
            "noticeOwed:0:errored": { attempt: 0, ending: "errored", due: 0 },
            "noticeUndeliverable:1:completed": { at: 0, detail: "x" },
            note: "kept",
          },
        },
      },
      ctx,
    );
    expect(result).toEqual({ ok: true });
    expect(taskA(ctx)?.metadata).toEqual({ "noticeOwed:1:completed": owed, note: "kept" });
  });

  it("still succeeds WITHOUT an assignee on a terminal task, writing every field", async () => {
    // Required by the guard's scoping: tagging a failed task after the fact is a
    // real and used thing. A helper-wide guard would refuse this.
    const ctx = ctxWithTask("errored", { priority: 1 });

    const result = await runForTest(
      findTool("updateTask"),
      { taskId: "a", patch: { priority: 9, metadata: { audited: true }, addLabel: "worker-error" } },
      ctx,
    );

    expect(result).toEqual({ ok: true });
    const task = taskA(ctx);
    expect(task?.priority).toBe(9);
    expect(task?.metadata).toEqual({ audited: true });
    expect(task?.labels).toEqual(["worker-error"]);
  });
});

/**
 * A release and a reassignment in one `updateTask` (FIX-2080). The release is
 * what lets the task start, so it lands last: a release first could start the
 * task with its old worker before the reassignment, and a refused
 * reassignment would then report failure for a task already running.
 */
describe("taskTools — updateTask that releases and reassigns at once", () => {
  it("leaves the task held when the reassignment is refused", async () => {
    // A follow-up keeps the worker of the task it follows, so its reassignment is refused.
    const ctx = ctxWithTask("held", { assignee: "researcher", followUpOf: "root" });

    const result = await runForTest(findTool("updateTask"), { taskId: "a", patch: { status: "pending", assignee: "writer" } }, ctx);

    expect(result).toMatchObject({ ok: false, taskId: "a" });
    expect(taskA(ctx)).toMatchObject({ status: "held", assignee: "researcher" });
  });

  it("reassigns before it releases when both are allowed", async () => {
    const ctx = ctxWithTask("held", { assignee: "researcher" });

    const result = await runForTest(findTool("updateTask"), { taskId: "a", patch: { status: "pending", assignee: "writer" } }, ctx);

    expect(result).toEqual({ ok: true });
    expect(taskA(ctx)).toMatchObject({ status: "pending", assignee: "writer" });
  });

  it("doesn't release a task that wasn't held, so a claim landing mid-call isn't reported as a refusal", async () => {
    // Pending, never started: there is nothing to release. A worker claims it
    // between the priority write and the end of the call.
    const ctx = ctxWithTask("pending", { assignee: "researcher", priority: 1 });
    const parent = (ctx as { parent: { state: Record<string, unknown>; atomicState: (fn: never) => Promise<void> } }).parent;
    const write = parent.atomicState.bind(parent);
    parent.atomicState = (async (fn: never) => {
      await write(fn);
      const board = parent.state[BOARD_FIELD] as Record<string, Record<string, unknown>>;
      if (board.a!.priority === 9) board.a = { ...board.a, status: "in_progress", attempts: 1, startedAt: Date.now() };
    }) as typeof parent.atomicState;

    const result = await runForTest(findTool("updateTask"), { taskId: "a", patch: { status: "pending", priority: 9 } }, ctx);

    expect(result).toEqual({ ok: true });
    expect(taskA(ctx)).toMatchObject({ status: "in_progress", priority: 9 });
  });

  it("writes nothing when the release is refused: a retried task has started", async () => {
    // The release would decline last, after the reassignment and the priority
    // landed, while the tool reports that the assignee won't change.
    const ctx = ctxWithTask("pending", { assignee: "researcher", attempts: 1, priority: 1 });

    const result = await runForTest(
      findTool("updateTask"),
      { taskId: "a", patch: { status: "pending", assignee: "writer", priority: 9 } },
      ctx,
    );

    expect(result).toMatchObject({ ok: false, taskId: "a" });
    expect((result as { error: string }).error).toContain("Its assignee will not change.");
    expect(taskA(ctx)).toMatchObject({ status: "pending", assignee: "researcher", priority: 1 });
  });
});

/**
 * The line between this change and the blanket `catch (err)` it rejected. The
 * soft set is exactly one error class; a scope-mutation failure is not on it and
 * must still reach the caller as a throw rather than becoming a polite result
 * the model narrates past.
 */
describe("taskTools — non-transition failures still propagate", () => {
  it("lets a scope-mutation failure escape instead of returning it as a result", async () => {
    const ctx = ctxWithTask("in_progress");
    (ctx as unknown as { parent: { atomicState: unknown } }).parent.atomicState = async () => {
      throw new Error("scope mutation timed out");
    };
    await expect(
      runForTest(findTool("completeTask"), { taskId: "a", output: "done" }, ctx),
    ).rejects.toThrow("scope mutation timed out");
  });
});
