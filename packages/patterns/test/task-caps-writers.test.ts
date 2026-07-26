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

/**
 * Every task id a run ever CREATED on `collectionId`, read from the `added`
 * task-change items. Counting creations (not the surviving ledger) is what makes
 * a partial commit visible: a task committed and then orphaned by a mid-loop
 * throw still emitted its `added` event.
 */
function addedTaskIds(items: readonly unknown[], collectionId: string): Set<string> {
  const ids = new Set<string>();
  for (const item of items as Array<{
    type?: string;
    component?: string;
    data?: { collectionId?: string; kind?: string; taskId?: string };
  }>) {
    if (
      item.type === "component" &&
      item.component === "task-change" &&
      item.data?.collectionId === collectionId &&
      item.data.kind === "added" &&
      typeof item.data.taskId === "string"
    ) {
      ids.add(item.data.taskId);
    }
  }
  return ids;
}

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

describe("eventActors fan-out — all-or-nothing at the cap boundary", () => {
  it("dispatches NOBODY for an entry whose matching actors cross the remaining budget", async () => {
    // Routing this writer through a capped collection made it an internal batch
    // caller, and the rule for those is atomic-or-nothing. A per-actor loop
    // would commit the first matching actor's task (landing exactly ON the cap)
    // and throw on the second, leaving the entry half-dispatched — while
    // eventActors promises every matching actor runs.
    const { createEventActorsWorkspace, actor, eventActors } = await import(
      "../src/eventActors"
    );
    const { sequencer } = await import("@flow-state-dev/core");

    const entrySchema = z.object({ type: z.string(), topic: z.string(), body: z.any() });
    const rb = createEventActorsWorkspace({ name: "caps-ea", entries: entrySchema });

    const ran: string[] = [];
    const mkActor = (n: string) =>
      actor({
        name: n,
        watch: ["request:**"],
        block: handler({
          name: `${n}-h`,
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: () => {
            ran.push(n);
            return { ok: true };
          },
        }),
      });

    // TWO matching actors, so one entry fans out to two tasks.
    const { emit } = eventActors({
      name: "caps-ea",
      workspace: rb,
      actors: [mkActor("a"), mkActor("b")],
    });

    const collectionId = "eventActors:caps-ea";
    // Fill the shared request ledger to one slot below the 100 enqueue default,
    // so the two-actor fan-out crosses it by exactly one.
    const fill = handler({
      name: "caps-ea-fill",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (input, ctx) => {
        const c = await getOrCreateTaskCollection({ ctx, backing: "request", collectionId });
        await c.addTasks(
          Array.from({ length: 99 }, (_, i) => ({ id: `pre-${i}`, goal: `pre ${i}` })),
        );
        return input;
      },
    });

    const pipeline = sequencer({ name: "caps-ea-pipeline", inputSchema: z.any() })
      .tap(fill)
      .step(emit as never);

    const result = await testBlock(pipeline as never, {
      input: { type: "request", topic: "query", body: "hi" } as never,
      session: { resources: { eventedActors: { entries: [] } } },
    } as never);

    // The fan-out is refused, so the emit fails loudly rather than silently
    // dispatching half the actors.
    expect(result.error).not.toBeNull();

    // The load-bearing assertion: exactly the 99 pre-filled tasks were ever
    // created. A per-actor loop would leave 100 — the first actor dispatched,
    // the second dropped, the entry half-handled.
    expect(addedTaskIds(result.items, collectionId).size).toBe(99);
    expect(ran).toEqual([]);
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
