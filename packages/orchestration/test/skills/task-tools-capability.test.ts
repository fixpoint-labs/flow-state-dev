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
import type { GeneratorTool } from "@flow-state-dev/core";

/**
 * Build a minimal BlockContext whose `ctx.parent` carries an own-state
 * delegation board (FIX-918). The default `taskTools` resolver reads the host
 * generator's own-state board via `ctx.parent`, so the mock parent exposes a
 * live `state` getter with a `delegationBoard` record plus a CAS-shaped
 * `atomicState` — the two surfaces `createSequencerBackedTaskCollection` uses.
 */
function buildDelegationCtx(opts: { preTasks?: Record<string, unknown> } = {}) {
  const parentState: Record<string, unknown> = {
    [DELEGATION_BOARD_FIELD]: opts.preTasks ?? {},
  };
  const parent = {
    name: "executive",
    instanceId: "executive#0",
    get state() {
      return parentState;
    },
    // Mirrors the real StateRef contract: the mutator returns a partial patch
    // that is merged into the state (not an in-place mutation).
    atomicState: async (
      fn: (
        state: Record<string, unknown>,
      ) => Promise<Record<string, unknown>> | Record<string, unknown>,
    ): Promise<void> => {
      const patch = await fn(parentState);
      Object.assign(parentState, patch);
    },
    patchState: async (updates: Record<string, unknown>) => {
      Object.assign(parentState, updates);
    },
  };
  return {
    parent,
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
    const ctx = buildDelegationCtx();
    const result = await runForTest(findTool("addTask"), { goal: "write report" }, ctx);
    expect((result as { ok: boolean }).ok).toBe(true);
    expect((result as { taskId: string }).taskId).toMatch(/^task_/);
  });

  it("addTask stores a structured input payload on the task", async () => {
    const ctx = buildDelegationCtx();
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
    const ctx = buildDelegationCtx({
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

  it("completeTask transitions a pending task to completed", async () => {
    const ctx = buildDelegationCtx({
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
    const ctx = buildDelegationCtx();
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
    const ctx = buildDelegationCtx();
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
    const ctx = buildDelegationCtx();
    const result = await runForTest(
      rosterTool("addTask"),
      { goal: "Find sources", assignee: "researcher" },
      ctx,
    );
    expect((result as { ok: boolean }).ok).toBe(true);
    expect(Object.values(boardOf(ctx))[0]?.assignee).toBe("researcher");
  });

  it("addTask accepts an unassigned task even with a roster (it runs on the floor)", async () => {
    const ctx = buildDelegationCtx();
    const result = await runForTest(rosterTool("addTask"), { goal: "anything" }, ctx);
    expect((result as { ok: boolean }).ok).toBe(true);
  });

  it("assignTask rejects an unknown assignee and leaves the task's assignee unchanged", async () => {
    const ctx = buildDelegationCtx({ preTasks: seededTask("researcher") });
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
    const ctx = buildDelegationCtx();
    const result = await runForTest(
      rosterTool("assignTask"),
      { taskId: "ghost", assignee: "nobody" },
      ctx,
    );
    expect((result as { error: string }).error).toBe("task_not_found");
  });

  it("updateTask rejects an unknown assignee in the patch", async () => {
    const ctx = buildDelegationCtx({ preTasks: seededTask("researcher") });
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
    const ctx = buildDelegationCtx({ preTasks: seededTask("researcher") });
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
    const ctx = buildDelegationCtx();
    const result = await runForTest(
      findTool("addTask"),
      { goal: "x", assignee: "whoever" },
      ctx,
    );
    expect((result as { ok: boolean }).ok).toBe(true);
    expect(Object.values(boardOf(ctx))[0]?.assignee).toBe("whoever");
  });

  it("assignTask accepts any assignee", async () => {
    const ctx = buildDelegationCtx({ preTasks: seededTask() });
    const result = await runForTest(
      findTool("assignTask"),
      { taskId: "a", assignee: "whoever" },
      ctx,
    );
    expect((result as { ok: boolean }).ok).toBe(true);
  });
});
