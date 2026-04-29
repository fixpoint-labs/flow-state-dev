/**
 * Factory: `getOrCreateTaskCollection({ backing, ... })`.
 *
 * One-call helper that builds a `TaskCollectionRef` against either backing
 * and adapts the substrate's `onChange` callback to the framework's
 * component-item stream via `ctx.emitComponent`.
 *
 * Each lifecycle transition emits a `task-change` component item keyed by
 * `${collectionId}/${taskId}`. The `key` ensures latest-wins replacement
 * per task in the client UI — `<Plan />` and the devtool subscribe to
 * these items, filter by `data.collectionId`, and render the board.
 */
import type { JsonObject } from "@flow-state-dev/core";
import type {
  BlockContext,
  ResourceCollectionRef,
  StateRef,
} from "@flow-state-dev/core/types";
import type { TaskCollectionRef } from "./types";
import type { TaskChangeEvent } from "./change-event";
import { createSequencerBackedTaskCollection } from "./sequencer-backed";
import { createResourceBackedTaskCollection } from "./resource-backed";

/** Component-item type emitted on every task lifecycle transition. */
export const TASK_CHANGE_COMPONENT_TYPE = "task-change";

/** Common options shared by both backings. */
interface CommonOptions {
  collectionId: string;
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
  const onChange = (event: TaskChangeEvent): void => {
    options.ctx.emitComponent(
      TASK_CHANGE_COMPONENT_TYPE,
      {
        collectionId: event.collectionId,
        taskId: event.taskId,
        kind: event.kind,
        task: event.task,
        ...(event.prevStatus !== undefined ? { prevStatus: event.prevStatus } : {}),
      },
      { key: `${event.collectionId}/${event.taskId}` }
    );
  };

  if (options.backing === "sequencer") {
    return createSequencerBackedTaskCollection<TInput, TOutput>({
      collectionId: options.collectionId,
      sequencer: options.sequencer,
      stateKey: options.stateKey,
      onChange,
      now: options.now,
    });
  }

  return createResourceBackedTaskCollection<TInput, TOutput>({
    collectionId: options.collectionId,
    collection: options.collection,
    onChange,
    now: options.now,
  });
}
