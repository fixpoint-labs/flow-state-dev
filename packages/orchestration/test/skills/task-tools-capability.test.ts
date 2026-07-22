import { describe, expect, it } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  taskTools,
  createTaskToolsCapability,
  delegationBoardSchema,
  DELEGATION_BOARD_FIELD,
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
