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
 *
 * The shared fixture's `self` and `parent` point at the SAME state on purpose,
 * and that matters here specifically: it is the shape in which an uncapped
 * `ctx.parent` resolver would still reach the right board — through an uncapped
 * view of it. So a cap biting in these tests is real evidence of the
 * convergence, not of the two paths landing on different boards.
 */
import { describe, expect, it, vi } from "vitest";
import { generator, handler } from "@flow-state-dev/core";
import type { DefinedCapability, GeneratorTool, InitialSkill } from "@flow-state-dev/core";
import { runForTest } from "@flow-state-dev/testing";
import { z } from "zod";
import { createSkillsLibrary } from "../../src/skills/library";
import { getOrCreateTaskCollection } from "../../src/tasks";
import {
  buildTaskToolsList,
  createTaskToolsCapability,
  DELEGATION_BOARD_FIELD,
} from "../../src/skills/task-tools-capability";
import { taskWorkerInputSchema } from "../../src/task-board";
import { buildDelegationCtx } from "./delegation-ctx";

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
  const { ctx, selfState } = buildDelegationCtx();
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

describe("delegation board addTask — failure ORDER across both gates", () => {
  // `addTask` now has four failure modes, and their order is a deliberate
  // contract rather than an artifact of how two PRs merged:
  //
  //   no board  ->  unknown assignee  ->  creation cap  ->  created
  //
  // The cap is LAST on purpose. "That worker doesn't exist" is the more
  // actionable message, and a task refused for a phantom assignee must never
  // reach the ledger — otherwise a typo'd add could be what consumes the budget
  // that a later valid add needed. Cap-first would also dead-end a caller at the
  // boundary: it would answer "board full" to someone whose real problem is the
  // assignee, which they would then hit again after fixing it.
  it("reports the unknown assignee, not the cap, when BOTH would fire", async () => {
    const { tools, ctx, selfState } = await buildSurface({ maxEnqueuedTasks: 2 });
    const addTask = toolNamed(tools, "addTask");

    // Fill the board to its enqueue bound with valid, unassigned tasks.
    const filled = await addN(addTask, ctx, 2);
    expect(filled.every((r) => r.ok)).toBe(true);

    // At the cap AND naming an agent that does not exist. Both gates would
    // refuse this; the assignee gate must be the one that answers.
    const both = (await runForTest(
      addTask,
      { goal: "over the cap with a phantom assignee", assignee: "ghost-agent" },
      ctx,
    )) as AddTaskResult;
    expect(both.ok).toBe(false);
    expect(both.error).toMatch(/^unknown_assignee/);
    expect(both.error).not.toMatch(/cap_exceeded/);

    // ...and it never reached the ledger, so it consumed no budget.
    const board = selfState[DELEGATION_BOARD_FIELD] as Record<string, unknown>;
    expect(Object.keys(board)).toHaveLength(2);

    // With a REAL agent, the same add at the same boundary reports the cap —
    // proving the assignee gate isn't simply masking it.
    const capped = (await runForTest(
      addTask,
      { goal: "over the cap with a real assignee", assignee: "analyst" },
      ctx,
    )) as AddTaskResult;
    expect(capped).toEqual({ ok: false, error: "enqueued_task_cap_exceeded" });
  });

  it("reports no_delegation_board ahead of both gates", async () => {
    // Pinned at the tool-factory level, not through the delegation surface.
    // That surface closes its resolver over the board it built, so `resolve`
    // ignores the ctx handed to the tool at call time and a board is always
    // returned — "no board WITH a roster" is unreachable through the shipped
    // wiring. Building the tools directly is what makes the code's ordering
    // observable, without pretending the combination is a production path.
    const roster = { has: () => false, describe: () => "analyst (…)" };
    const [addTaskOnly] = buildTaskToolsList(async () => undefined, roster);
    const result = (await runForTest(
      addTaskOnly as never,
      { goal: "x", assignee: "ghost-agent" },
      buildDelegationCtx().ctx,
    )) as AddTaskResult;
    // A phantom assignee is present, but the board gate answers first.
    expect(result.error).toBe("no_delegation_board");
  });
});

describe("the documented hand-wired bounded board actually runs", () => {
  // `apps/docs/docs/skills/delegation.md` shows how to bound a `taskTools`
  // capability wired by hand. Nothing in CI executes a docs snippet, so the
  // recipe is pinned here instead — an example that does not run is a bug with
  // a longer fuse than a failing test.
  //
  // The first version of that snippet resolved `sequencer: ctx.sequencer!` with
  // no `stateKey`. Both were wrong, and wrong in different ways: with no
  // enclosing sequencer it THREW ("Cannot read properties of undefined"), and
  // with one it silently wrote to a `tasks` slot instead of the board's. The
  // second is the dangerous one — it looks like it worked.
  const boundedResolver = (ctx: never) =>
    getOrCreateTaskCollection({
      ctx,
      backing: "sequencer",
      // The HOST generator's own state. Each tool runs as a child block, so the
      // generator's state is `ctx.parent`, not `ctx.sequencer`.
      sequencer: (ctx as unknown as { parent: never }).parent,
      stateKey: DELEGATION_BOARD_FIELD,
      collectionId: DELEGATION_BOARD_FIELD,
      maxEnqueuedTasks: 2,
    });

  it("resolves the host generator's board and enforces the bound", async () => {
    const cap = createTaskToolsCapability(boundedResolver as never);
    const addTask = capabilityAddTask(cap);
    const { ctx, selfState } = buildDelegationCtx();

    const results: AddTaskResult[] = [];
    for (let i = 0; i < 3; i++) {
      results.push((await runForTest(addTask, { goal: `t${i}` }, ctx)) as AddTaskResult);
    }

    // Two land, the third is refused by the bound the recipe configures.
    expect(results.slice(0, 2).every((r) => r.ok)).toBe(true);
    expect(results[2]).toEqual({ ok: false, error: "enqueued_task_cap_exceeded" });

    // And they landed on the DELEGATION BOARD slot — not some adjacent `tasks`
    // slot the host never reads. This is the assertion the broken snippet failed.
    const board = selfState[DELEGATION_BOARD_FIELD] as Record<string, unknown>;
    expect(Object.keys(board)).toHaveLength(2);
    expect(selfState.tasks).toBeUndefined();
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
