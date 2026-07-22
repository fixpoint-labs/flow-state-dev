/**
 * The delegation path, end-to-end and deterministic (FIX-918): a coordinator
 * generator bound to the bundled skills gets the task tools, one tool per
 * worker, and `runBoard`. The tests do exactly what the SKILL.md instructs the
 * model to do — plan tasks with `addTask` (assignee, deps, input), then call
 * `runBoard` — and assert the board executed the graph with the example's
 * deterministic handler workers. No model, no API key.
 */
import { describe, it, expect } from "vitest";
import { generator } from "@flow-state-dev/core";
import type { GeneratorTool } from "@flow-state-dev/core";
import { runForTest, testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import { skillsLibrary } from "../src/skills";

/** A coordinator bound to both bundled skills, like the flow's chat action. */
function buildCoordinator() {
  return generator({
    name: "test-coordinator",
    model: "openai/gpt-5.4-mini",
    prompt: "coordinate",
    inputSchema: z.object({}),
    uses: [
      skillsLibrary.with({
        active: ["research-company", "competitor-analysis"],
      } as never),
    ],
  });
}

/**
 * A mock generator execution context: `self` carries the own-state delegation
 * board the binding declares; `parent` mirrors it the way tool children see
 * the host generator. atomicState follows the real StateRef contract (the
 * mutator returns a partial patch that is merged).
 */
function buildExecCtx() {
  const selfState: Record<string, unknown> = { delegationBoard: {} };
  const stateRef = {
    name: "test-coordinator",
    instanceId: "test-coordinator#0",
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
  return {
    self: stateRef,
    parent: stateRef,
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

async function resolveTools(
  gen: ReturnType<typeof generator>,
  ctx: unknown,
): Promise<GeneratorTool[]> {
  const tools = (gen.config as { tools?: unknown }).tools;
  if (typeof tools === "function") return (await (tools as Function)(undefined, ctx)) ?? [];
  return (tools as GeneratorTool[]) ?? [];
}

function toolNamed(tools: GeneratorTool[], name: string): GeneratorTool {
  const tool = tools.find(
    (t) =>
      ((t as { config?: { name?: string } }).config?.name ?? (t as { name?: string }).name) ===
      name,
  );
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool;
}

type RunBoardOutput = {
  status: string;
  tasks: Array<{ id: string; goal: string; status: string; assignee?: string; output?: unknown }>;
};

describe("research-team delegation skills", () => {
  it("binding both skills installs the shared team once: task tools, workers, runBoard", async () => {
    const gen = buildCoordinator();
    const tools = await resolveTools(gen, buildExecCtx());
    const names = tools.map(
      (t) => (t as { config?: { name?: string } }).config?.name ?? (t as { name?: string }).name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "addTask",
        "listTasks",
        "market-analyst",
        "financial-analyst",
        "competitor-analyst",
        "synthesizer",
        "runBoard",
      ]),
    );
    // Both skills declare `synthesizer` with the same block-ref — deduped.
    expect(names.filter((n) => n === "synthesizer")).toHaveLength(1);
  });

  it("research-company: analysts in parallel, synthesizer gated on both", async () => {
    const gen = buildCoordinator();
    const ctx = buildExecCtx();
    const tools = await resolveTools(gen, ctx);
    const addTask = toolNamed(tools, "addTask");
    const runBoard = toolNamed(tools, "runBoard");

    // What the SKILL.md instructs the coordinator to do:
    const market = (await runForTest(
      addTask,
      { goal: "market analysis", assignee: "market-analyst", input: { subject: "ACME Corp" } },
      ctx,
    )) as { taskId: string };
    const financial = (await runForTest(
      addTask,
      { goal: "financial analysis", assignee: "financial-analyst", input: { subject: "ACME Corp" } },
      ctx,
    )) as { taskId: string };
    await runForTest(
      addTask,
      {
        goal: "combined brief",
        assignee: "synthesizer",
        deps: [market.taskId, financial.taskId],
        input: { subject: "ACME Corp" },
      },
      ctx,
    );

    const run = await testBlock(runBoard as never, { input: {} as never });
    expect(run.error).toBeNull();
    const output = run.output as RunBoardOutput;
    expect(output.status).toBe("drained");
    expect(output.tasks.every((t) => t.status === "completed")).toBe(true);

    const report = (
      output.tasks.find((t) => t.assignee === "synthesizer")?.output as { report: string }
    ).report;
    expect(report).toContain("market: ACME Corp");
    expect(report).toContain("financial: ACME Corp");
  });

  it("competitor-analysis: one analyzer per competitor, synthesizer gated on all", async () => {
    const gen = buildCoordinator();
    const ctx = buildExecCtx();
    const tools = await resolveTools(gen, ctx);
    const addTask = toolNamed(tools, "addTask");
    const runBoard = toolNamed(tools, "runBoard");

    const competitors = ["Jira", "Asana", "Trello"];
    const analyzerIds: string[] = [];
    for (const name of competitors) {
      const added = (await runForTest(
        addTask,
        { goal: `analyze ${name}`, assignee: "competitor-analyst", input: { subject: name } },
        ctx,
      )) as { taskId: string };
      analyzerIds.push(added.taskId);
    }
    await runForTest(
      addTask,
      {
        goal: "comparison matrix",
        assignee: "synthesizer",
        deps: analyzerIds,
        input: { subject: "Linear" },
      },
      ctx,
    );

    const run = await testBlock(runBoard as never, { input: {} as never });
    expect(run.error).toBeNull();
    const output = run.output as RunBoardOutput;
    expect(output.status).toBe("drained");
    expect(output.tasks).toHaveLength(4);

    const report = (
      output.tasks.find((t) => t.assignee === "synthesizer")?.output as { report: string }
    ).report;
    for (const name of competitors) {
      expect(report).toContain(`competitor: ${name}`);
    }
  });

  it("a second plan-then-run on the same ledger drains only the new tasks", async () => {
    // Run identity comes from task status: ids are generated, the drain claims
    // pending tasks only. No per-call collection id, no UUID bookkeeping.
    const gen = buildCoordinator();
    const ctx = buildExecCtx();
    const tools = await resolveTools(gen, ctx);
    const addTask = toolNamed(tools, "addTask");
    const runBoard = toolNamed(tools, "runBoard");

    await runForTest(
      addTask,
      { goal: "first", assignee: "market-analyst", input: { subject: "ACME Corp" } },
      ctx,
    );
    const first = await testBlock(runBoard as never, { input: {} as never });
    expect((first.output as RunBoardOutput).tasks).toHaveLength(1);

    await runForTest(
      addTask,
      { goal: "second", assignee: "market-analyst", input: { subject: "Globex Inc" } },
      ctx,
    );
    const second = await testBlock(runBoard as never, { input: {} as never });
    const output = second.output as RunBoardOutput;
    expect(output.status).toBe("drained");
    expect(output.tasks).toHaveLength(2);
    expect(output.tasks.every((t) => t.status === "completed")).toBe(true);
    const fresh = output.tasks.find((t) => t.goal === "second")!;
    expect((fresh.output as { findings: string }).findings).toBe("market: Globex Inc");
  });
});
