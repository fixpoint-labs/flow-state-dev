/**
 * Seed initial tasks into a Task Board collection.
 *
 * State-mutation-only — wired with `.tap()` per BP-012. No
 * `outputSchema`, no `return input`.
 *
 * Idempotent on retry: if any task with a given id already lives in
 * the collection, that init is skipped. Tasks without a stable `id`
 * are always added — don't pass `initialTasks` without ids on a flow
 * you expect to retry.
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
