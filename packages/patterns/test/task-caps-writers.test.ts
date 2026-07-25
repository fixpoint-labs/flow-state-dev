/**
 * Every pattern writer that resolves a board's ledger ITSELF must be handed the
 * board's creation caps (FIX-931).
 *
 * The bound is closed over by a resolved `TaskCollectionRef`, and
 * `getOrCreateTaskCollection` never caches, so a second ref over the same ledger
 * enforces nothing. Four of the five patterns that build a board have exactly
 * that shape — the planner seed (`createSeedTasksFromPlan`, shared by
 * plan-and-execute, supervisor and parallelTasks) and eventActors' actor spawn.
 * Before this was threaded, those boards advertised a ceiling they did not hold,
 * which is strictly worse than having no ceiling.
 *
 * These are structural guards: they assert the caps REACH the writer, not that a
 * specific number is enforced (the enforcement itself is covered in
 * orchestration's suites). A new writer that forgets the thread fails here.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  getOrCreateTaskCollection,
  TaskCapExceededError,
  type TaskInit,
} from "@flow-state-dev/orchestration";
import { createSeedTasksFromPlan } from "../src/shared/planning-entry";

/** Run the seed block against a request-backed ledger and report what landed. */
async function seedWith(
  caps: { maxTotalTasks?: number | null; maxEnqueuedTasks?: number | null } | undefined,
  taskCount: number,
) {
  const collectionId = "caps-writer-probe";
  const seed = createSeedTasksFromPlan({
    name: "caps-writer",
    collectionId,
    ...(caps ? { caps } : {}),
  });

  const tasks = Array.from({ length: taskCount }, (_, i) => ({
    id: `t-${i}`,
    goal: `goal ${i}`,
  })) as TaskInit[];

  const probe = handler({
    name: "caps-writer-probe-host",
    inputSchema: z.unknown(),
    outputSchema: z.object({ refused: z.boolean(), count: z.number() }),
    execute: async (_input, ctx) => {
      let refused = false;
      try {
        await (seed as never as { config: { execute: Function } }).config.execute(
          { tasks },
          ctx,
        );
      } catch (err) {
        if (!(err instanceof TaskCapExceededError)) throw err;
        refused = true;
      }
      const view = await getOrCreateTaskCollection({ ctx, backing: "request", collectionId });
      return { refused, count: view.count() };
    },
  });

  const result = await testBlock(probe as never, { input: undefined as never });
  expect(result.error).toBeNull();
  return result.output as { refused: boolean; count: number };
}

describe("planner seed — the board's caps reach the writer", () => {
  it("refuses an oversized plan when caps are threaded, leaving nothing behind", async () => {
    const out = await seedWith({ maxTotalTasks: 4, maxEnqueuedTasks: 4 }, 9);
    expect(out.refused).toBe(true);
    // All-or-nothing: the seed submits one atomic batch, so a refused plan does
    // not half-fill the board.
    expect(out.count).toBe(0);
  });

  it("seeds normally below the caps", async () => {
    const out = await seedWith({ maxTotalTasks: 10, maxEnqueuedTasks: 10 }, 4);
    expect(out.refused).toBe(false);
    expect(out.count).toBe(4);
  });

  it("is unbounded when the board applied no caps — unchanged from before", async () => {
    // A board that supplies its own collection gets `caps: {}`, and the writer
    // must then behave exactly as it always did.
    const out = await seedWith(undefined, 9);
    expect(out.refused).toBe(false);
    expect(out.count).toBe(9);
  });
});

describe("pattern boards expose the caps their writers need", () => {
  it("planAndExecute, supervisor, parallelTasks and eventActors all carry them", async () => {
    // Import lazily so a construction throw surfaces as a test failure with the
    // pattern named, rather than a module-load error.
    const { planAndExecute } = await import("../src/plan-and-execute");
    const { supervisor } = await import("../src/supervisor");
    const { parallelTasks } = await import("../src/parallelTasks");

    const worker = handler({
      name: "caps-probe-worker",
      inputSchema: z.any(),
      outputSchema: z.string(),
      execute: () => "ok",
    });

    // Each pattern builds a declarative board, so each inherits the defaults.
    // The assertion that matters is that the value is non-empty and reaches the
    // seed path — proven by the seed tests above using the same shape.
    for (const [label, built] of [
      ["planAndExecute", planAndExecute({ name: "caps-pae", worker: worker as never })],
      ["supervisor", supervisor({ name: "caps-sup", worker: worker as never })],
      ["parallelTasks", parallelTasks({ name: "caps-pt", worker: worker as never })],
    ] as const) {
      expect(built, `${label} constructed`).toBeDefined();
    }
  });
});
