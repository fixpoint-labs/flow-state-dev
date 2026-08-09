import { describe, expect, it } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  taskTools,
  buildTaskToolsList,
  checkAssignee,
  createTaskToolsCapability,
  defaultOwnStateResolver,
  delegationBoardSchema,
  DELEGATION_BOARD_FIELD,
  type WorkerRoster,
} from "../../src/skills/task-tools-capability";
import { buildDelegationCtx } from "./delegation-ctx";
import type { GeneratorTool } from "@flow-state-dev/core";


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

/** Look up a tool by name from the capability's preset surface. */
function findTool(name: string): GeneratorTool {
  const presetDefs = (taskTools as unknown as {
    __presetDefs?: { tools?: { tools?: GeneratorTool[] } };
  }).__presetDefs;
  const tool = presetDefs?.tools?.tools?.find((t) => t.config?.name === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool;
}

describe("taskTools capability", () => {
  it("registers eight tools under the default preset", () => {
    const presetDefs = (taskTools as unknown as {
      __presetDefs?: { tools?: { tools?: GeneratorTool[] } };
    }).__presetDefs;
    const names = presetDefs?.tools?.tools?.map((t) => t.config?.name).sort();
    expect(names).toEqual([
      "addTask",
      "assignTask",
      "blockTask",
      "cancelTask",
      "completeTask",
      "failTask",
      "listTasks",
      "updateTask",
    ]);
  });

  it("createTaskToolsCapability returns a freshly composable capability", () => {
    const cap = createTaskToolsCapability();
    expect(cap.name).toBe("taskTools");
  });

  it("no tool description names runBoard, which this surface does not install", () => {
    // Companion to the FIX-950 error-message assertion further down — same rule, at the description level.
    const tools = buildTaskToolsList();
    expect(tools).toHaveLength(8);
    for (const tool of tools) {
      expect(tool.config?.description, `${tool.config?.name} names runBoard`).not.toContain(
        "runBoard",
      );
    }
  });

  it("addTask still documents both creation caps it can return", () => {
    // Dropping the drain-tool reference must not drop the cap vocabulary with
    // it — `addTask` genuinely returns these two errors when the board it
    // resolves has ceilings, and the model needs to recognize them to react.
    const description = findTool("addTask").config?.description ?? "";
    expect(description).toContain("enqueued_task_cap_exceeded");
    expect(description).toContain("total_task_cap_exceeded");
  });
});

describe("delegation board state slot", () => {
  it("initializes from an empty parse, so the board exists on first use", () => {
    // The engine seeds a block's initial own state via `stateSchema.safeParse({})`
    // (see engine route-utils). Without a field default that parse fails, the
    // state starts as `{}`, and the first addTask hits `no_delegation_board`
    // even though the binding declared the board.
    const hostSchema = z.object({ [DELEGATION_BOARD_FIELD]: delegationBoardSchema });
    const parsed = hostSchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({ [DELEGATION_BOARD_FIELD]: {} });
  });
});

describe("taskTools — happy paths (own-state board)", () => {
  it("addTask creates a task on the delegation board", async () => {
    const { ctx } = buildCtx();
    const result = await runForTest(findTool("addTask"), { goal: "write report" }, ctx);
    expect((result as { ok: boolean }).ok).toBe(true);
    expect((result as { taskId: string }).taskId).toMatch(/^task_/);
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
        DELEGATION_BOARD_FIELD
      ] as Record<string, { input?: unknown }>
    );
    expect(board[taskId]?.input).toEqual({ subject: "ACME" });
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
 * A two-agent roster standing in for what the delegation surface derives from
 * its board worker registry.
 */
const testRoster: WorkerRoster = {
  has: (a) => a === "researcher" || a === "writer",
  describe: () => "researcher (Researches sources), writer (Drafts prose)",
};

/** The roster-carrying tools, as the delegation surface builds them. */
function rosterTool(name: string): GeneratorTool {
  const tool = buildTaskToolsList(defaultOwnStateResolver, testRoster).find(
    (t) => (t as { config?: { name?: string } }).config?.name === name,
  );
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool as GeneratorTool;
}

/** Read the live board record off a mock ctx. */
function boardOf(ctx: unknown): Record<string, { assignee?: string }> {
  return (ctx as { parent: { state: Record<string, unknown> } }).parent.state[
    DELEGATION_BOARD_FIELD
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
    // The floor (FIX-940) is reached by deliberately omitting the assignee.
    // Closing that would break rosterless delegation, not just typos.
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
    // The standalone `taskTools` singleton knows no workers, so it has nothing
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
    DELEGATION_BOARD_FIELD
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

  it("blockTask on an in_progress task reports not-ok instead of throwing", async () => {
    const ctx = ctxWithTask("in_progress");
    const result = await runForTest(findTool("blockTask"), { taskId: "a", reason: "legal" }, ctx);
    expect(result).toMatchObject({ ok: false, taskId: "a" });
    expect((result as { error: string }).error).toContain("illegal_status_transition");
    expect(statusOfA(ctx)).toBe("in_progress");
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
    expect(error).toContain("From here you can call blockTask or cancelTask.");
    // The rejected tool excludes itself: its target is by definition not allowed.
    expect(error).not.toContain("completeTask");
    // Said without asserting HOW a task gets started — this surface does not
    // know whether its consumer has a drain tool.
    expect(error).toContain("has not been started yet");
  });

  it("does not imply an unblock exists for a blocked task", async () => {
    const error = await errorFrom(
      "completeTask",
      { taskId: "a", output: "done" },
      ctxWithTask("blocked"),
    );
    expect(error).toContain('task "a" is blocked');
    // No tool unblocks a task. `allowedTransitionsFrom("blocked")` claims
    // `pending`, reachable ONLY via failTask with a retry budget — which this
    // budget-less task does not have. The message must not suggest otherwise.
    expect(error).not.toMatch(/unblock/i);
    expect(error).not.toContain("pending");
    expect(error).toContain("cancelTask");
    expect(error).not.toContain("failTask");
  });

  it("still offers blockTask on a blocked task, because that call does real work", async () => {
    // Pins the RULE ("would this call succeed") against the alternative reading
    // that a blocked task should advertise only `cancelTask`. `block()` on an
    // already-blocked task is a legal same-status transition that rewrites the
    // reason and emits a `blocked` change, so the rule keeps it. Suppressing it
    // would require a same-status filter, which is the thing that would also
    // silently drop a budgeted `failTask` from a `pending` task's list.
    //
    // This assertion is the difference between the two readings: without it the
    // blocked case passes under either, and a filter could be reintroduced
    // unnoticed.
    const error = await errorFrom(
      "completeTask",
      { taskId: "a", output: "done" },
      ctxWithTask("blocked"),
    );
    expect(error).toContain("From here you can call blockTask or cancelTask.");
  });

  it("names the calls available from awaiting_review without claiming pending", async () => {
    const error = await errorFrom(
      "blockTask",
      { taskId: "a", reason: "legal" },
      ctxWithTask("awaiting_review"),
    );
    expect(error).toContain('task "a" is awaiting_review');
    // `allowedTransitionsFrom("awaiting_review")` includes `pending`; no tool
    // reaches it from here, so the recovery list must not mention it.
    expect(error).not.toContain("pending");
    expect(error).toContain("cancelTask");
    expect(error).toContain("completeTask");
    expect(error).toContain("failTask");
  });

  it("states a terminal task as terminal, without rendering an empty action list", async () => {
    const error = await errorFrom(
      "blockTask",
      { taskId: "a", reason: "legal" },
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
    const probes: Array<[status: string, tool: string]> = [
      ["pending", "completeTask"],
      ["in_progress", "blockTask"],
      ["blocked", "completeTask"],
      ["awaiting_review", "blockTask"],
    ];
    for (const [status, tool] of probes) {
      const error = await errorFrom(tool, { taskId: "a", reason: "r" }, ctxWithTask(status));
      const clause = /From here you can call (.+)\.$/.exec(error.trim());
      expect(clause, `${tool} from ${status} advertised no calls`).not.toBeNull();
      expect(clause![1]!.trim()).not.toBe("");
      expect(clause![1]).not.toContain("undefined");
    }
  });

  it("never names runBoard, which is not one of these tools", async () => {
    // Paired so each source status gets a tool that actually refuses from it.
    // `completeTask` is NOT usable to provoke one from `completed`: same-status
    // is a legal no-op that succeeds, which is why `blockTask` probes there.
    const probes: Array<[status: string, tool: string]> = [
      ["pending", "completeTask"],
      ["in_progress", "blockTask"],
      ["blocked", "completeTask"],
      ["awaiting_review", "blockTask"],
      ["completed", "blockTask"],
    ];
    for (const [status, tool] of probes) {
      const input =
        tool === "blockTask" ? { taskId: "a", reason: "legal" } : { taskId: "a", output: "done" };
      const error = await errorFrom(tool, input, ctxWithTask(status));
      // `taskTools` ships standalone; `runBoard` is installed by the delegation
      // surface. Naming it would point a directly-wired consumer at a tool it
      // does not have.
      expect(error).not.toContain("runBoard");
    }
  });
});

/**
 * `failTask`'s target is conditional on the task's retry budget, so the composer
 * asks `shouldRetryOnFail` about the task in hand rather than assuming.
 *
 * Note the layer: these tasks are seeded with `maxAttempts` directly onto the
 * board. The delegation `addTask` TOOL exposes no `maxAttempts`, so tasks
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
      DELEGATION_BOARD_FIELD
    ] as Record<
      string,
      { assignee?: string; priority?: number; labels?: string[]; metadata?: unknown }
    >
  ).a;
}

/**
 * The defect this issue is about. Against a task that already finished, three of
 * these tools used to give three different answers and only one was true:
 * `blockTask` refused honestly, `cancelTask` said it worked and did nothing, and
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
      // Names what the caller actually attempted. `blockTask`'s copy says "its
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

  it("reads the same as blockTask's refusal on the same task, bar the code and the clause", async () => {
    // Decision 6: one parameterized renderer, not four bespoke messages. The
    // sentence shape and the closing suggestion have to match, or the four tools
    // drift into four ways of saying the same thing.
    const blocked = await errorFrom("blockTask", { taskId: "a", reason: "r" }, ctxWithTask("completed"));
    const cancelled = await errorFrom("cancelTask", { taskId: "a" }, ctxWithTask("completed"));

    const shape = (error: string) => error.replace(/^[a-z_]+:/, "CODE:");
    expect(shape(cancelled)).toBe(shape(blocked));
  });

  it("cancelTask still succeeds on a live task", async () => {
    // The control. The refusal must not touch the case it is not for.
    const ctx = ctxWithTask("pending");
    const result = await runForTest(findTool("cancelTask"), { taskId: "a" }, ctx);
    expect(result).toEqual({ ok: true });
    expect(statusOfA(ctx)).toBe("cancelled");
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
