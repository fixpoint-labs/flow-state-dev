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
 * create a fresh state per `board.drain` invocation, so the `tasks`
 * slot doesn't persist across calls. Use a resource-collection-backed
 * collection for that, or wait on substrate work to lift the state
 * into a parent slot.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { TaskCollectionRef, TaskInit } from "../../tasks";

export interface SeedCollectionOptions<TInput = unknown> {
  name: string;
  collection: (ctx: BlockContext) => Promise<TaskCollectionRef<TInput, unknown>>;
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
      const collection = await collectionFactory(ctx);
      // ONE atomic `addTasks`, not a per-task loop (FIX-931). A loop that awaits
      // each insert commits tasks up to a creation cap and only then throws — a
      // partial seed. The batch is all-or-nothing, so an oversized seed leaves
      // the board exactly as it found it.
      //
      // The running `seen` set preserves what the old loop got for free by
      // re-reading `collection.get` after each awaited insert: it skipped
      // duplicate ids WITHIN one `initialTasks` list as well as ids already in
      // the collection. A one-time filter against the collection alone would let
      // both copies reach `addTasks`, whose duplicate-id guard would then reject
      // the ENTIRE seed.
      const seen = new Set<string>();
      const batch: TaskInit<TInput>[] = [];
      for (const init of initialTasks) {
        if (init.id !== undefined) {
          if (seen.has(init.id) || collection.get(init.id) !== undefined) continue;
          seen.add(init.id);
        }
        batch.push(init);
      }
      if (batch.length > 0) await collection.addTasks(batch);
    },
  });
}
