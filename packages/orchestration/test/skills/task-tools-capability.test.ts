import { describe, expect, it } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import { z } from "zod";
import { taskTools, createTaskToolsCapability } from "../../src/skills/task-tools-capability";
import type { GeneratorTool } from "@flow-state-dev/core";
import type { ActiveSkillEntry } from "../../src/skills/active-skill-state";

/**
 * Build a minimal BlockContext + sessionState shape carrying a single
 * `mode: "pattern"` activeSkill entry. The collection is request-backed,
 * so `getActivePatternCollection` reaches `getOrCreateTaskCollection`
 * which reads `ctx.request.state[collectionId]`.
 */
function buildPatternCtx(opts: { skillName?: string; preTasks?: Record<string, unknown> } = {}) {
  const skillName = opts.skillName ?? "demo";
  const collectionId = `skill_${skillName}`;
  const requestState: Record<string, unknown> = {
    [collectionId]: opts.preTasks ?? {},
  };
  const entry: ActiveSkillEntry = {
    name: skillName,
    mode: "pattern",
    activatedAt: Date.now(),
    pattern: {
      patternKey: "task-board",
      collectionId,
      backing: "request",
    },
  };
  const request = {
    identity: { id: "r1", userId: "u1" },
    state: requestState,
    patchState: async (updates: Record<string, unknown>) => {
      Object.assign(requestState, updates);
    },
    setState: async (next: Record<string, unknown>) => {
      for (const k of Object.keys(requestState)) delete requestState[k];
      Object.assign(requestState, next);
    },
    incState: async (key: string, delta: number) => {
      requestState[key] = ((requestState[key] as number) ?? 0) + delta;
    },
    pushState: async (key: string, value: unknown) => {
      const arr = (requestState[key] as unknown[]) ?? [];
      arr.push(value);
      requestState[key] = arr;
    },
    setStateRecord: async (
      record: string,
      key: string,
      value: unknown,
    ) => {
      const rec = (requestState[record] as Record<string, unknown>) ?? {};
      rec[key] = value;
      requestState[record] = rec;
    },
    deleteStateRecord: async (record: string, key: string) => {
      const rec = requestState[record] as Record<string, unknown> | undefined;
      if (rec) delete rec[key];
    },
    atomicState: async <T>(
      fn: (state: Record<string, unknown>) => Promise<T> | T,
    ): Promise<T> => fn(requestState),
  };
  return {
    request,
    session: {
      identity: { id: "s1", userId: "u1" },
      state: { activeSkills: [entry] },
      patchState: async () => {},
    },
    org: { identity: { type: "org" as const, id: "p1" } },
    user: {},
    resources: { get: () => undefined, list: () => [] },
    signal: new AbortController().signal,
    response: {
      emit: async () => {},
      getItems: () => [],
    },
    cap: {},
    getTarget: () => undefined,
    getBlockOutput: () => undefined,
    getBlockResult: () => ({ status: "not_started" as const }),
    targets: {},
    emit: { message: () => {}, component: () => {}, status: () => {} },
  } as never;
}

/** Build a context with no active pattern entry. */
function buildNoPatternCtx() {
  return {
    request: { identity: { id: "r1", userId: "u1" }, state: {} },
    session: {
      identity: { id: "s1", userId: "u1" },
      state: { activeSkills: [] },
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

describe("taskTools — happy paths", () => {
  it("addTask creates a task on the active board", async () => {
    const ctx = buildPatternCtx();
    const result = await runForTest(findTool("addTask"), { goal: "write report" }, ctx);
    expect((result as { ok: boolean }).ok).toBe(true);
    expect((result as { taskId: string }).taskId).toMatch(/^task_/);
  });

  it("listTasks returns the seeded board entries", async () => {
    const ctx = buildPatternCtx({
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
    const ctx = buildPatternCtx({
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

describe("taskTools — no active pattern", () => {
  it("addTask returns the no_active_pattern error rather than throwing", async () => {
    const ctx = buildNoPatternCtx();
    const result = await runForTest(findTool("addTask"), { goal: "x" }, ctx);
    expect(result).toEqual({ ok: false, error: "no_active_pattern" });
  });

  it("listTasks returns the no_active_pattern error rather than throwing", async () => {
    const ctx = buildNoPatternCtx();
    const result = await runForTest(findTool("listTasks"), {}, ctx);
    expect(result).toEqual({ ok: false, error: "no_active_pattern" });
  });
});

describe("taskTools — unknown task ids", () => {
  it("completeTask returns task_not_found for an unknown id", async () => {
    const ctx = buildPatternCtx();
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

// Suppress unused import warnings.
void z;
