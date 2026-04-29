/**
 * Factory: `getOrCreateTaskCollection({ backing, ... })`.
 *
 * One-call helper that builds a `TaskCollectionRef` against either backing
 * and wires the task_change emission frame from the supplied
 * `BlockContext`. Patterns and dispatchers consume the returned ref;
 * neither knows nor cares which backing produced it.
 */
import type { JsonObject } from "@flow-state-dev/core";
import type {
  BlockContext,
  ResourceCollectionRef,
  StateRef,
} from "@flow-state-dev/core/types";
import type { TaskCollectionRef } from "./types";
import { createSequencerBackedTaskCollection } from "./sequencer-backed";
import { createResourceBackedTaskCollection } from "./resource-backed";
import {
  buildEmissionFrame,
  buildEmitter,
} from "../items/emission";

/** Common options shared by both backings. */
interface CommonOptions {
  collectionId: string;
  /** When true, omit `transient` on emitted `task_change` items so they persist. Default: false. */
  persistTaskEvents?: boolean;
  /** Clock injection for tests. Default: `Date.now`. */
  now?: () => number;
}

/** Sequencer-state backing options. */
export interface SequencerBackingSpec extends CommonOptions {
  backing: "sequencer";
  /**
   * Sequencer state ref. Typically `ctx.sequencer`. The sequencer's
   * stateSchema must include a record at `[stateKey]` (default `"tasks"`)
   * shaped as `Record<string, Task>`.
   */
  sequencer: StateRef<Record<string, unknown>>;
  stateKey?: string;
}

/** Resource-collection backing options. */
export interface ResourceBackingSpec extends CommonOptions {
  backing: "resource";
  /** The parameterized resource collection ref. Pattern: `someTopic/{id}`. */
  collection: ResourceCollectionRef<JsonObject>;
}

export type GetOrCreateTaskCollectionOptions =
  | (SequencerBackingSpec & { ctx: BlockContext })
  | (ResourceBackingSpec & { ctx: BlockContext });

/**
 * Build a TaskCollectionRef against the chosen backing. The factory does
 * not allocate the underlying storage — the caller is expected to have
 * declared it (sequencer state schema, resource collection definition).
 *
 * Example (sequencer-backed):
 * ```ts
 * const tasks = getOrCreateTaskCollection({
 *   ctx,
 *   backing: "sequencer",
 *   collectionId: "my-plan",
 *   sequencer: ctx.sequencer!,
 * });
 * ```
 */
export function getOrCreateTaskCollection<TInput = unknown, TOutput = unknown>(
  options: GetOrCreateTaskCollectionOptions
): TaskCollectionRef<TInput, TOutput> {
  const frame = buildEmissionFrame(options.ctx);
  const emit = buildEmitter(options.ctx);

  if (options.backing === "sequencer") {
    return createSequencerBackedTaskCollection<TInput, TOutput>({
      collectionId: options.collectionId,
      sequencer: options.sequencer,
      stateKey: options.stateKey,
      emit,
      frame,
      persistTaskEvents: options.persistTaskEvents,
      now: options.now,
    });
  }

  return createResourceBackedTaskCollection<TInput, TOutput>({
    collectionId: options.collectionId,
    collection: options.collection,
    emit,
    frame,
    persistTaskEvents: options.persistTaskEvents,
    now: options.now,
  });
}
