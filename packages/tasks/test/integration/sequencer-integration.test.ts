/**
 * Integration tests — exercise the sequencer-state backing through the
 * full BlockContext path via `testBlock`. Verifies:
 *   - `getOrCreateTaskCollection` works with a real `ctx.sequencer`.
 *   - Lifecycle mutations emit `task-change` component items via
 *     `ctx.emitComponent`, keyed by `${collectionId}/${taskId}` for
 *     latest-wins replacement per task.
 *   - State-snapshot items at step boundaries carry the tasks map
 *     (FIX-401 keyed-update + checkpoint write contract).
 *   - Terminal `state_snapshot` is emitted at sequencer completion.
 */
import { describe, expect, it } from "vitest";
import { handler, sequencer } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import type { OutputItem } from "@flow-state-dev/core/items";
import { z } from "zod";
import {
  fifoDispatcher,
  getOrCreateTaskCollection,
  taskSchema,
} from "../../src";

const tasksStateSchema = z.object({
  tasks: z.record(z.string(), taskSchema).default({}),
});

describe("sequencer-state integration", () => {
  it("getOrCreateTaskCollection works inside a handler with ctx.sequencer", async () => {
    const seedTasks = handler({
      name: "seed-tasks",
      inputSchema: z.any(),
      outputSchema: z.any(),
      sequencerStateSchema: tasksStateSchema,
      execute: async (_input, ctx) => {
        const collection = getOrCreateTaskCollection({
          ctx,
          backing: "sequencer",
          collectionId: "plan",
          sequencer: ctx.sequencer!,
        });
        await collection.addTask({ id: "a", goal: "alpha" });
        await collection.addTask({ id: "b", goal: "beta" });
        return { count: collection.count() };
      },
    });

    const dispatchOne = handler({
      name: "dispatch-one",
      inputSchema: z.any(),
      outputSchema: z.any(),
      sequencerStateSchema: tasksStateSchema,
      execute: async (_input, ctx) => {
        const collection = getOrCreateTaskCollection({
          ctx,
          backing: "sequencer",
          collectionId: "plan",
          sequencer: ctx.sequencer!,
        });
        const task = await fifoDispatcher.claim(collection, "worker-1", ctx);
        if (task !== null) {
          await collection.complete(task.id, `done:${task.goal}`);
        }
        return { taskId: task?.id };
      },
    });

    const pipeline = sequencer({
      name: "task-pipeline",
      inputSchema: z.any(),
      outputSchema: z.any(),
      stateSchema: tasksStateSchema,
    })
      .then(seedTasks)
      .then(dispatchOne)
      .then(dispatchOne);

    const result = await testBlock(pipeline, { input: undefined });

    expect(result.error).toBeNull();

    // Top-level sequencer state isn't surfaced on `result.state.sequencer`
    // (testBlock only exposes that for wrapped non-sequencer blocks). Read
    // the latest state_snapshot from the items log — this is also the
    // FIX-401 durability contract surface.
    const snapshotItems = result.items.filter(
      (item) => (item as { type: string }).type === "state_snapshot"
    ) as Array<{ state?: { tasks?: Record<string, { status: string; output?: unknown }> }; key: string }>;

    const lastSnapshot = snapshotItems.at(-1);
    const tasksMap = lastSnapshot?.state?.tasks ?? {};
    expect(tasksMap.a?.status).toBe("completed");
    expect(tasksMap.b?.status).toBe("completed");
    expect(tasksMap.a?.output).toBe("done:alpha");
    expect(tasksMap.b?.output).toBe("done:beta");
  });

  it("emits task-change component items for every lifecycle transition", async () => {
    const body = handler({
      name: "lifecycle",
      inputSchema: z.any(),
      outputSchema: z.any(),
      sequencerStateSchema: tasksStateSchema,
      execute: async (_input, ctx) => {
        const collection = getOrCreateTaskCollection({
          ctx,
          backing: "sequencer",
          collectionId: "plan",
          sequencer: ctx.sequencer!,
        });
        await collection.addTask({ id: "t", goal: "do" });
        await collection.claim("w");
        await collection.complete("t", "ok");
        return null;
      },
    });

    const block = sequencer({
      name: "wrap",
      inputSchema: z.any(),
      outputSchema: z.any(),
      stateSchema: tasksStateSchema,
    }).then(body);

    const result = await testBlock(block, { input: undefined });

    type TaskChangeComponent = OutputItem & {
      type: string;
      component?: string;
      data?: { collectionId?: string; kind?: string; taskId?: string };
      key?: string;
    };
    const taskChangeItems = result.items.filter(
      (item: OutputItem & { type?: string }) => {
        const i = item as TaskChangeComponent;
        return i.type === "component" && i.component === "task-change";
      }
    ) as TaskChangeComponent[];

    const kinds = taskChangeItems.map((i) => i.data?.kind);
    expect(kinds).toContain("added");
    expect(kinds).toContain("claimed");
    expect(kinds).toContain("completed");
    for (const item of taskChangeItems) {
      expect(item.data?.collectionId).toBe("plan");
      expect(item.key).toBe(`plan/${item.data?.taskId}`);
    }
  });

  it("state_snapshot at step boundaries carries the tasks map (FIX-401 contract)", async () => {
    const seedTasks = handler({
      name: "seed",
      inputSchema: z.any(),
      outputSchema: z.any(),
      sequencerStateSchema: tasksStateSchema,
      execute: async (_input, ctx) => {
        const collection = getOrCreateTaskCollection({
          ctx,
          backing: "sequencer",
          collectionId: "plan",
          sequencer: ctx.sequencer!,
        });
        await collection.addTask({ id: "a", goal: "alpha" });
        return null;
      },
    });

    const noop = handler({
      name: "noop",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => null,
    });

    const block = sequencer({
      name: "wrap",
      inputSchema: z.any(),
      outputSchema: z.any(),
      stateSchema: tasksStateSchema,
    })
      .then(seedTasks)
      .then(noop);

    const result = await testBlock(block, { input: undefined });

    const snapshotItems = result.items.filter(
      (item: OutputItem & { type?: string }) =>
        (item as { type: string }).type === "state_snapshot"
    ) as Array<OutputItem & { state?: unknown; durable?: boolean; terminal?: boolean; version?: number }>;

    // At least one snapshot must contain the seeded task in tasks map.
    const carryingTasks = snapshotItems.filter((s) => {
      const state = s.state as { tasks?: Record<string, unknown> } | undefined;
      return state?.tasks?.["a"] !== undefined;
    });
    expect(carryingTasks.length).toBeGreaterThan(0);

    // Durability default is true: at least one durable snapshot expected.
    expect(snapshotItems.some((s) => s.durable === true)).toBe(true);

    // Terminal snapshot fires at sequencer completion (FIX-401 GC signal).
    expect(snapshotItems.some((s) => s.terminal === true)).toBe(true);
  });
});
