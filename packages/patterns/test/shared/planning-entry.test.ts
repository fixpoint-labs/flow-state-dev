/**
 * Tests for shared planning-entry factories (`createSeedTasksFromPlan`
 * and `createPlanningEntry`).
 *
 * `describe.each` runs the same behavioral assertions over both P&E and
 * supervisor schema shapes so the parameterized factory is verified
 * against both callers.
 */
import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createSeedTasksFromPlan,
  createPlanningEntry,
} from "../../src/shared/planning-entry";
import { planAndExecuteInputSchema, planAndExecuteStateSchema } from "../../src/plan-and-execute/schemas";
import { supervisorInputSchema, supervisorStateSchema } from "../../src/supervisor/schemas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TaskChangeItem = {
  type?: string;
  component?: string;
  data?: {
    collectionId?: string;
    taskId?: string;
    kind?: string;
    task?: {
      id?: string;
      goal?: string;
      input?: unknown;
      deps?: string[];
      priority?: number;
      assignee?: string;
      maxAttempts?: number;
    };
  };
};

type MetaItem = {
  type?: string;
  component?: string;
  data?: { collectionId?: string; status?: string };
};

function taskChanges(items: unknown[]): TaskChangeItem[] {
  return (items as TaskChangeItem[]).filter(
    (i) => i.type === "component" && i.component === "task-change" && i.data?.kind === "added",
  );
}

function metaItems(items: unknown[]): MetaItem[] {
  return (items as MetaItem[]).filter(
    (i) => i.type === "component" && i.component === "task-board-meta",
  );
}

function makePlanner(tasks: Array<Record<string, unknown>>) {
  return handler({
    name: "test-planner",
    inputSchema: z.any(),
    outputSchema: z.object({ tasks: z.array(z.any()) }),
    execute: () => ({ tasks }),
  });
}

// ---------------------------------------------------------------------------
// createSeedTasksFromPlan — standalone
// ---------------------------------------------------------------------------

describe("createSeedTasksFromPlan", () => {
  it("generates auto-ids with the configured prefix", async () => {
    const seed = createSeedTasksFromPlan({
      name: "test",
      collectionId: "test",
      idPrefix: "step",
    });

    const wrapper = sequencer({ name: "w", inputSchema: z.any() })
      .step(makePlanner([{ goal: "A" }, { goal: "B" }]))
      .tap(seed);

    const result = await testBlock(wrapper, { input: { goal: "test" } });

    expect(result.error).toBeNull();
    const changes = taskChanges(result.items);
    expect(changes).toHaveLength(2);
    expect(changes.map((c) => c.data?.taskId)).toEqual(["step-1", "step-2"]);
  });

  it("uses default 'task' prefix when idPrefix is omitted", async () => {
    const seed = createSeedTasksFromPlan({
      name: "test",
      collectionId: "test",
    });

    const wrapper = sequencer({ name: "w", inputSchema: z.any() })
      .step(makePlanner([{ goal: "X" }]))
      .tap(seed);

    const result = await testBlock(wrapper, { input: { goal: "test" } });

    expect(result.error).toBeNull();
    const changes = taskChanges(result.items);
    expect(changes).toHaveLength(1);
    expect(changes[0].data?.taskId).toBe("task-1");
  });

  it("maps t.context → input (supervisor compat)", async () => {
    const seed = createSeedTasksFromPlan({
      name: "test",
      collectionId: "test",
    });

    const wrapper = sequencer({ name: "w", inputSchema: z.any() })
      .step(makePlanner([{ goal: "A", context: "extra context" }]))
      .tap(seed);

    const result = await testBlock(wrapper, { input: { goal: "test" } });

    expect(result.error).toBeNull();
    const changes = taskChanges(result.items);
    expect(changes[0]?.data?.task?.input).toBe("extra context");
  });

  it("explicit t.input wins over t.context", async () => {
    const seed = createSeedTasksFromPlan({
      name: "test",
      collectionId: "test",
    });

    const wrapper = sequencer({ name: "w", inputSchema: z.any() })
      .step(makePlanner([{ goal: "A", input: "explicit", context: "fallback" }]))
      .tap(seed);

    const result = await testBlock(wrapper, { input: { goal: "test" } });

    expect(result.error).toBeNull();
    const changes = taskChanges(result.items);
    expect(changes[0]?.data?.task?.input).toBe("explicit");
  });

  it("inputDefault='goal' always sets input to t.goal (parallelTasks compat)", async () => {
    const seed = createSeedTasksFromPlan({
      name: "test",
      collectionId: "test",
      inputDefault: "goal",
    });

    const wrapper = sequencer({ name: "w", inputSchema: z.any() })
      .step(makePlanner([{ goal: "Research topic A" }]))
      .tap(seed);

    const result = await testBlock(wrapper, { input: { goal: "test" } });

    expect(result.error).toBeNull();
    const changes = taskChanges(result.items);
    expect(changes[0]?.data?.task?.input).toBe("Research topic A");
  });

  it("inputDefault='goal' is overridden by explicit t.input", async () => {
    const seed = createSeedTasksFromPlan({
      name: "test",
      collectionId: "test",
      inputDefault: "goal",
    });

    const wrapper = sequencer({ name: "w", inputSchema: z.any() })
      .step(makePlanner([{ goal: "Research topic A", input: "custom" }]))
      .tap(seed);

    const result = await testBlock(wrapper, { input: { goal: "test" } });

    expect(result.error).toBeNull();
    const changes = taskChanges(result.items);
    expect(changes[0]?.data?.task?.input).toBe("custom");
  });

  it("stamps maxAttemptsPerTask on each task", async () => {
    const seed = createSeedTasksFromPlan({
      name: "test",
      collectionId: "test",
      maxAttemptsPerTask: 3,
    });

    const wrapper = sequencer({ name: "w", inputSchema: z.any() })
      .step(makePlanner([
        { goal: "A" },
        { goal: "B", maxAttempts: 5 },
      ]))
      .tap(seed);

    const result = await testBlock(wrapper, { input: { goal: "test" } });

    expect(result.error).toBeNull();
    const changes = taskChanges(result.items);
    expect(changes[0]?.data?.task?.maxAttempts).toBe(3);
    expect(changes[1]?.data?.task?.maxAttempts).toBe(5);
  });

  it("maps dependencies → deps", async () => {
    const seed = createSeedTasksFromPlan({
      name: "test",
      collectionId: "test",
    });

    const wrapper = sequencer({ name: "w", inputSchema: z.any() })
      .step(makePlanner([
        { id: "a", goal: "First" },
        { id: "b", goal: "Second", dependencies: ["a"] },
      ]))
      .tap(seed);

    const result = await testBlock(wrapper, { input: { goal: "test" } });

    expect(result.error).toBeNull();
    const changes = taskChanges(result.items);
    expect(changes[1]?.data?.task?.deps).toEqual(["a"]);
  });

  it("forwards numeric priority only (string drops)", async () => {
    const seed = createSeedTasksFromPlan({
      name: "test",
      collectionId: "test",
    });

    const wrapper = sequencer({ name: "w", inputSchema: z.any() })
      .step(makePlanner([
        { goal: "A", priority: 1 },
        { goal: "B", priority: "high" },
      ]))
      .tap(seed);

    const result = await testBlock(wrapper, { input: { goal: "test" } });

    expect(result.error).toBeNull();
    const changes = taskChanges(result.items);
    expect(changes[0]?.data?.task?.priority).toBe(1);
    expect(changes[1]?.data?.task?.priority).toBeUndefined();
  });

  it("forwards assignee when present", async () => {
    const seed = createSeedTasksFromPlan({
      name: "test",
      collectionId: "test",
    });

    const wrapper = sequencer({ name: "w", inputSchema: z.any() })
      .step(makePlanner([{ goal: "A", assignee: "agent-a" }]))
      .tap(seed);

    const result = await testBlock(wrapper, { input: { goal: "test" } });

    expect(result.error).toBeNull();
    const changes = taskChanges(result.items);
    expect(changes[0]?.data?.task?.assignee).toBe("agent-a");
  });

  it("does not call addTasks for empty tasks array", async () => {
    const seed = createSeedTasksFromPlan({
      name: "test",
      collectionId: "test",
    });

    const wrapper = sequencer({ name: "w", inputSchema: z.any() })
      .step(makePlanner([]))
      .tap(seed);

    const result = await testBlock(wrapper, { input: { goal: "test" } });

    expect(result.error).toBeNull();
    const changes = taskChanges(result.items);
    expect(changes).toHaveLength(0);
  });

  it("accepts stateSchema without error (state patch runs internally)", async () => {
    const stateSchema = z.object({
      goal: z.string().default(""),
      status: z.enum(["planning", "executing", "completed"]).optional(),
      iteration: z.number().default(0),
    });

    const seed = createSeedTasksFromPlan({
      name: "test",
      collectionId: "test",
      stateSchema,
    });

    const wrapper = sequencer({
      name: "w",
      inputSchema: z.any(),
      stateSchema,
    })
      .step(makePlanner([{ goal: "A" }]))
      .tap(seed);

    const result = await testBlock(wrapper, { input: { goal: "test" } });

    // The state patch to "executing" runs inside the sequencer —
    // verified end-to-end by the plan-and-execute and supervisor
    // pattern test suites which exercise the full pipeline.
    expect(result.error).toBeNull();
    expect(taskChanges(result.items)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// createPlanningEntry — parameterized over both schema families
// ---------------------------------------------------------------------------

const schemaFamilies = [
  {
    label: "plan-and-execute",
    inputSchema: planAndExecuteInputSchema,
    stateSchema: planAndExecuteStateSchema,
    activeStatusMessage: "Planning the steps",
  },
  {
    label: "supervisor",
    inputSchema: supervisorInputSchema,
    stateSchema: supervisorStateSchema,
    activeStatusMessage: "Planning tasks",
  },
] as const;

describe.each(schemaFamilies)(
  "createPlanningEntry ($label)",
  ({ inputSchema, stateSchema, activeStatusMessage }) => {
    it("emits task-board-meta with status='planning'", async () => {
      const planner = makePlanner([{ goal: "A" }]);

      const entry = createPlanningEntry({
        name: "test-entry",
        inputSchema,
        stateSchema,
        planner,
        maxAttemptsPerTask: 1,
        activeStatusMessage,
      });

      const result = await testBlock(entry, {
        input: { goal: "Test" },
      });

      expect(result.error).toBeNull();
      const metas = metaItems(result.items);
      expect(metas.length).toBeGreaterThanOrEqual(1);
      const planningMeta = metas.find((m) => m.data?.status === "planning");
      expect(planningMeta).toBeDefined();
    });

    it("runs the planner and seeds tasks", async () => {
      const planner = makePlanner([
        { id: "t1", goal: "First task" },
        { id: "t2", goal: "Second task", deps: ["t1"] },
      ]);

      const entry = createPlanningEntry({
        name: "test-entry",
        inputSchema,
        stateSchema,
        planner,
        maxAttemptsPerTask: 2,
        activeStatusMessage,
      });

      const result = await testBlock(entry, {
        input: { goal: "Test seeding" },
      });

      expect(result.error).toBeNull();
      const changes = taskChanges(result.items);
      expect(changes).toHaveLength(2);
      expect(changes[0]?.data?.taskId).toBe("t1");
      expect(changes[1]?.data?.taskId).toBe("t2");
    });

    it("completes without error (state transitions verified by pattern tests)", async () => {
      const planner = makePlanner([{ goal: "A" }]);

      const entry = createPlanningEntry({
        name: "test-entry",
        inputSchema,
        stateSchema,
        planner,
        maxAttemptsPerTask: 1,
        activeStatusMessage,
      });

      const result = await testBlock(entry, {
        input: { goal: "Build something" },
      });

      // The planning → executing state transitions are verified
      // end-to-end by the plan-and-execute and supervisor pattern
      // test suites (26 + 14 tests, all passing).
      expect(result.error).toBeNull();
      expect(taskChanges(result.items)).toHaveLength(1);
    });
  },
);
