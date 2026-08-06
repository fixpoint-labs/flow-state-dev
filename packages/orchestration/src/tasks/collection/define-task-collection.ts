/**
 * `defineTaskCollection` — declare a durable, resource-backed task collection
 * in one line, symmetric with `defineSkillsCollection` /
 * `defineScheduleCollection`.
 *
 * A durable board's tasks survive across turns because they live as instances
 * of a parameterized resource collection (`<id>/*`) at `session` / `user` /
 * `org` scope, rather than on request or sequencer state. Pass the result to
 * `taskBoard({ collection })` and the board registers + resolves it for you —
 * consumers never touch the resource wiring.
 *
 * The returned value is a real `defineResourceCollection` (it keeps the
 * `__brand: "ResourceCollection"`) plus an additive `__taskCollection` marker
 * carrying the id, so `taskBoard()` can tell a durable collection apart from a
 * request/sequencer spec.
 *
 * @example
 *   const todos = defineTaskCollection({
 *     id: "todos",
 *     scope: "user",
 *     stateSchema: z.object({ topic: z.string() }),
 *   });
 *   const board = taskBoard({ name: "todos", collection: todos, workers });
 */

import { defineResourceCollection } from "@flow-state-dev/core";
import type {
  DefinedResourceCollection,
  ResourceScope,
} from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";
import { taskSchema } from "../schema/task";
import { assertSafeCollectionId } from "./safe-key";

/**
 * Build the resource-instance schema for a durable task: the whole `Task`
 * validated permissively, with `Task.input` narrowed to the caller's payload
 * schema. `input` stays `.optional()` (not `.nullable().default(null)`) so an
 * omitted payload round-trips as omitted rather than a synthesized `null`.
 */
export function taskEnvelopeSchema(inputSchema: ZodTypeAny): ZodTypeAny {
  return taskSchema.extend({ input: inputSchema.optional() });
}

/**
 * A durable task collection: a `DefinedResourceCollection` (brand preserved)
 * plus an additive marker identifying it as a task collection and carrying its
 * literal id.
 */
export type DefinedTaskCollection = DefinedResourceCollection & {
  readonly __taskCollection: { readonly id: string };
};

export interface DefineTaskCollectionOptions<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
> {
  /**
   * Literal collection id. Forms the resource pattern (`<id>/*`), the
   * `ctx.resources` lookup key, and the board's `collectionId`. Must be a
   * single plain segment — no `*`/`[param]` pattern tokens, no `/`, no
   * prototype-poisoning names.
   */
  id: string;
  /** Intrinsic scope the collection lives in — `"session"`, `"user"`, or `"org"`. */
  scope: ResourceScope;
  /**
   * Schema for each task's `input` payload. Optional; defaults to
   * `z.unknown()`. This is the typed payload a worker receives, not the whole
   * task — the rest of the `Task` envelope is validated automatically.
   */
  stateSchema?: TInputSchema;
  /** Maximum number of tasks retained in the collection. Optional. */
  maxInstances?: number;
}

/**
 * Define a durable, resource-backed task collection. See module doc.
 */
export function defineTaskCollection<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
>(
  options: DefineTaskCollectionOptions<TInputSchema>
): DefinedTaskCollection {
  assertSafeCollectionId(options.id);

  // Type the envelope as a bare `ZodTypeAny` before handing it to
  // `defineResourceCollection` so the extended `taskSchema` doesn't inflate the
  // const-generic inference (the `DefinedTaskCollection` return type is
  // hand-declared, so nothing downstream needs the precise inferred shape).
  const envelope: ZodTypeAny = taskEnvelopeSchema(
    (options.stateSchema ?? z.unknown()) as ZodTypeAny
  );

  const collection = defineResourceCollection({
    // Keep durable task ids to one path segment so this collection cannot read
    // or overwrite resources owned by a nested collection with the same prefix.
    pattern: `${options.id}/*`,
    scope: options.scope,
    stateSchema: envelope,
    ...(options.maxInstances !== undefined
      ? { maxInstances: options.maxInstances }
      : {}),
  });

  return Object.assign(collection, {
    __taskCollection: { id: options.id },
  }) as unknown as DefinedTaskCollection;
}

/** Runtime narrowing: is `value` a `DefinedTaskCollection`? */
export function isDefinedTaskCollection(
  value: unknown
): value is DefinedTaskCollection {
  if (typeof value !== "object" || value === null) return false;
  const v = value as {
    __brand?: unknown;
    __taskCollection?: { id?: unknown };
  };
  return (
    v.__brand === "ResourceCollection" &&
    typeof v.__taskCollection === "object" &&
    v.__taskCollection !== null &&
    typeof v.__taskCollection.id === "string"
  );
}
