/**
 * Seed initial tasks into a Task Board collection.
 *
 * State-mutation-only — wired with `.tap()` per BP-012. No
 * `outputSchema`, no `return input`.
 *
 * Idempotent on replay: if any task with a given id already lives in
 * the collection, that init is skipped. Critical for retry/resume
 * scenarios — without this, a second pass over the same `initialTasks`
 * would throw on the substrate's "task with id X already exists" guard.
 *
 * Tasks without a stable `id` are always added (the substrate
 * generates a fresh id each time). Don't pass `initialTasks` without
 * explicit ids on any flow that may replay the seed step.
 *
 * Note: seed idempotency makes the seed step itself safe to re-run.
 * Whether the surrounding board can be cleanly re-entered (e.g. inside
 * a replan loop) is a separate concern — sequencer-backed boards
 * create a fresh state per `board.block` invocation, so the `tasks`
 * slot doesn't persist across calls. Use a resource-collection-backed
 * collection for that, or wait on substrate work to lift the state
 * into a parent slot.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { TaskCollectionRef, TaskInit } from "@flow-state-dev/tasks";

export interface SeedCollectionOptions<TInput = unknown> {
  name: string;
  collection: (ctx: BlockContext) => TaskCollectionRef<TInput, unknown>;
  initialTasks: readonly TaskInit<TInput>[];
}

/** Builds the seed handler. Runs once at the top of the Task Board sequencer. */
export function createSeedCollection<TInput = unknown>(
  options: SeedCollectionOptions<TInput>
) {
  const { name, collection: collectionFactory, initialTasks } = options;
  return handler({
    name,
    // Substrate-internal seed step; tasks become user-visible via
    // `task-change kind:"added"` items emitted by `collection.addTask`.
    transient: true,
    inputSchema: z.unknown(),
    execute: async (_input, ctx) => {
      if (initialTasks.length === 0) return;
      const collection = collectionFactory(ctx);
      for (const init of initialTasks) {
        if (init.id !== undefined && collection.get(init.id) !== undefined) {
          continue;
        }
        await collection.addTask(init);
      }
    },
  });
}
