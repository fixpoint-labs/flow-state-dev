/**
 * Delegation-board creation caps (FIX-931).
 *
 * The delegation board is the path this guard exists for, and the trace that
 * produced the design found two writers for it that built their own uncapped
 * ref: `getOrCreateTaskCollection` never caches, so a cap living in a
 * constructor closure only holds if every writer resolves through the SAME
 * construction. These tests pin that down at the two that matter:
 *
 *  - the EXECUTIVE's `addTask` — the flat model-facing tool surface, which used
 *    to fall back to `defaultOwnStateResolver` and its own ref. That is the
 *    primary over-spawn vector, so it failing loudly here is the point.
 *  - a WORKER's mid-drain fan-out — the board-bound `taskTools` capability
 *    handed to each materialized worker.
 *
 * The tool contract is asserted too: a breach is a SOFT error the model can act
 * on (drain, then continue), with distinct codes per cap — never a throw into
 * the turn.
 */
import { describe, expect, it, vi } from "vitest";
import { generator, handler } from "@flow-state-dev/core";
import type { DefinedCapability, GeneratorTool, InitialSkill } from "@flow-state-dev/core";
import { runForTest } from "@flow-state-dev/testing";
import { z } from "zod";
import { createSkillsLibrary } from "../../src/skills/library";
import { DELEGATION_BOARD_FIELD } from "../../src/skills/task-tools-capability";
import { taskWorkerInputSchema } from "../../src/task-board";
import { createMockSkillsCollection } from "./mocks";

const workerBlock = handler({
  name: "caps-analyst",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ findings: z.string() }),
  execute: () => ({ findings: "ok" }),
});

const teamSkill: InitialSkill = {
  name: "caps-team",
  skillMd: [
    "---",
    "description: a delegating team",
    "agents:",
    "  analyst:",
    "    agent-ref: analyst-agent",
    "---",
    "",
    "Plan tasks with addTask, then call runBoard.",
  ].join("\n"),
};

/**
 * A mock generator execution context. `self` is the generator's own-state ref
 * (where the delegation board lives) and `parent` mirrors it, which is what a
 * tool child sees. Both point at the SAME state on purpose: that is the shape
 * in which an uncapped `ctx.parent` resolver would still reach the right board
 * — through an uncapped view of it. So a cap biting here is real evidence of
 * the convergence, not of the two paths landing on different boards.
 */
function buildExecCtx() {
  const collection = createMockSkillsCollection();
  const selfState: Record<string, unknown> = { [DELEGATION_BOARD_FIELD]: {} };
  const stateRef = {
    name: "executive",
    instanceId: "executive#0",
    get state() {
      return selfState;
    },
    atomicState: async (
      fn: (
        state: Record<string, unknown>,
      ) => Promise<Record<string, unknown>> | Record<string, unknown>,
    ): Promise<void> => {
      Object.assign(selfState, await fn(selfState));
    },
    patchState: async (updates: Record<string, unknown>) => {
      Object.assign(selfState, updates);
    },
  };
  const ctx = {
    self: stateRef,
    parent: stateRef,
    request: { identity: { id: "r1", userId: "u1" }, state: {} },
    session: { identity: { id: "s1", userId: "u1" }, state: {}, patchState: async () => {} },
    org: { identity: { type: "org" as const, id: "p1" } },
    user: {},
    resources: {
      skills: collection,
      get: (k: string) => (k === "skills" ? collection : undefined),
      list: () => [collection],
    },
    signal: new AbortController().signal,
    response: { emit: async () => {}, getItems: () => [] },
    cap: {},
    getTarget: () => undefined,
    getBlockOutput: () => undefined,
    getBlockResult: () => ({ status: "not_started" as const }),
    targets: {},
    emit: { message: () => {}, component: () => {}, status: () => {} },
  };
  return { ctx: ctx as never, selfState };
}

/** Capture each worker's materialize options so the fan-out surface is reachable. */
function deterministicAgents(captured: Array<Record<string, unknown>>) {
  return {
    agentRegistry: {
      get: vi.fn(async (name: string) => ({ name })),
      list: vi.fn(async () => [{ name: "analyst-agent" }]),
    },
    materializeAgent: vi.fn((_agent: unknown, opts: Record<string, unknown>) => {
      captured.push(opts);
      return workerBlock as never;
    }),
  };
}

function toolName(t: GeneratorTool): string | undefined {
  return (t as { config?: { name?: string } }).config?.name ?? (t as { name?: string }).name;
}

async function resolveTools(
  gen: ReturnType<typeof generator>,
  ctx: unknown,
): Promise<GeneratorTool[]> {
  const tools = (gen.config as { tools?: unknown }).tools;
  if (typeof tools === "function") return (await (tools as Function)(undefined, ctx)) ?? [];
  return (tools as GeneratorTool[]) ?? [];
}

function toolNamed(tools: GeneratorTool[], name: string): GeneratorTool {
  const tool = tools.find((t) => toolName(t) === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool;
}

/** The `addTask` tool a board-bound `taskTools` capability exposes to a worker. */
function capabilityAddTask(capability: DefinedCapability): GeneratorTool {
  const presetDefs = (capability as unknown as {
    __presetDefs?: { tools?: { tools?: GeneratorTool[] } };
  }).__presetDefs;
  const tool = presetDefs?.tools?.tools?.find((t) => toolName(t) === "addTask");
  if (!tool) throw new Error("board-bound taskTools exposes no addTask");
  return tool;
}

interface AddTaskResult {
  ok: boolean;
  error?: string;
  taskId?: string;
}

/** Build the executive's tool surface for a library with the given cap options. */
async function buildSurface(
  libraryOptions: { maxTotalTasks?: number | null; maxEnqueuedTasks?: number | null } = {},
) {
  const captured: Array<Record<string, unknown>> = [];
  const skills = createSkillsLibrary({
    catalog: {},
    initialSkills: [teamSkill],
    ...deterministicAgents(captured),
    ...libraryOptions,
  });
  const gen = generator({
    name: "executive",
    model: "openai/gpt-5.4-mini",
    prompt: "delegate",
    inputSchema: z.object({}),
    uses: [skills.with({ active: ["caps-team"] } as never)],
  });
  const { ctx, selfState } = buildExecCtx();
  const tools = await resolveTools(gen, ctx);
  return { tools, ctx, selfState, captured };
}

/** Call `addTask` `n` times, returning every result in order. */
async function addN(tool: GeneratorTool, ctx: never, n: number): Promise<AddTaskResult[]> {
  const results: AddTaskResult[] = [];
  for (let i = 0; i < n; i++) {
    results.push((await runForTest(tool, { goal: `task ${i}` }, ctx)) as AddTaskResult);
  }
  return results;
}

describe("delegation board caps — the executive's addTask", () => {
  it("is capped, and reports the enqueue breach as a soft error", async () => {
    const { tools, ctx, selfState } = await buildSurface({ maxEnqueuedTasks: 3 });
    const results = await addN(toolNamed(tools, "addTask"), ctx, 5);

    expect(results.slice(0, 3).every((r) => r.ok)).toBe(true);
    // Soft, not a throw — the model must be able to recover by draining.
    expect(results[3]).toEqual({ ok: false, error: "enqueued_task_cap_exceeded" });
    expect(results[4]).toEqual({ ok: false, error: "enqueued_task_cap_exceeded" });
    // Nothing was written past the cap.
    const board = selfState[DELEGATION_BOARD_FIELD] as Record<string, unknown>;
    expect(Object.keys(board)).toHaveLength(3);
  });

  it("reports the lifetime breach with its own distinct code", async () => {
    const { tools, ctx } = await buildSurface({ maxTotalTasks: 2, maxEnqueuedTasks: 2 });
    const results = await addN(toolNamed(tools, "addTask"), ctx, 3);
    expect(results[2]).toEqual({ ok: false, error: "total_task_cap_exceeded" });
  });

  it("applies the 100-task enqueue default when the library sets no cap", async () => {
    const { tools, ctx } = await buildSurface();
    const results = await addN(toolNamed(tools, "addTask"), ctx, 101);
    expect(results.filter((r) => r.ok)).toHaveLength(100);
    expect(results[100]).toEqual({ ok: false, error: "enqueued_task_cap_exceeded" });
  });

  it("honors an explicit `null` as unbounded on that axis", async () => {
    const { tools, ctx } = await buildSurface({ maxEnqueuedTasks: null });
    const results = await addN(toolNamed(tools, "addTask"), ctx, 105);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});

describe("delegation board caps — a worker's mid-drain fan-out", () => {
  it("writes through the same capped board as the executive", async () => {
    const { tools, ctx, captured } = await buildSurface({ maxEnqueuedTasks: 2 });

    // The executive fills the enqueue budget itself.
    const executiveResults = await addN(toolNamed(tools, "addTask"), ctx, 2);
    expect(executiveResults.every((r) => r.ok)).toBe(true);

    // A worker fanning out mid-drain uses the board-bound taskTools it was
    // materialized with. If that resolved its own ref, this would succeed and
    // the board would grow past the cap behind the executive's back.
    const boardTaskTools = captured[0]?.boardTaskTools as DefinedCapability;
    expect(boardTaskTools).toBeDefined();
    const fanOut = (await runForTest(
      capabilityAddTask(boardTaskTools),
      { goal: "follow-up work" },
      ctx,
    )) as AddTaskResult;
    expect(fanOut).toEqual({ ok: false, error: "enqueued_task_cap_exceeded" });
  });
});
