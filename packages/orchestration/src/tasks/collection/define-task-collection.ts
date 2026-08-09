/**
 * `defineTaskCollection` — declare a durable, resource-backed task collection
 * in one line, symmetric with `defineSkillsCollection` /
 * `defineScheduleCollection`.
 *
 * A durable board's tasks survive across turns because they live as instances
 * of a parameterized resource collection (`<id>/**`) at `session` / `user` /
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
   * Literal collection id. Forms the resource pattern (`<id>/**`), the
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
    // `<id>/**` (deep), not `<id>/*`: task ids may contain slashes (a caller can
    // seed `{ id: "parent/child" }`, which the request/sequencer backings store
    // fine). A single-level `/*` would reject those keys on a durable board, so
    // the same tasks must round-trip through the resource pattern too.
    pattern: `${options.id}/**`,
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

/**
 * Ledgers whose assignee is frozen, keyed by the declaration itself (FIX-982).
 *
 * The policy belongs to the **ledger**, not to a ref. `getOrCreateTaskCollection`
 * builds a fresh wrapper per resolution, so an `immutableAssignee` passed as one
 * wrapper's option guards only the caller that passed it — a second board, or any
 * other resolution of the same collection, gets an unguarded wrapper over the
 * same rows and can reassign a task the detached board routes by. Marking the
 * declaration instead means every resolution reads one answer.
 *
 * Keyed by object identity rather than collection id: ids are per-flow strings,
 * and two unrelated flows in one process may both call their collection `tasks`.
 * Within a flow the identity is not a choice — two boards sharing a ledger must
 * pass the same `defineTaskCollection` value, because the resource merge refuses
 * two different references under one accessor key. The boundary that buys is
 * per-flow: two *separate* declarations of the same id and non-isolated scope in
 * two flows address the same rows while counting as different ledgers here. That
 * configuration is already ambiguous for everything else the declaration carries
 * (its schema, its instance cap), so it is left alone rather than special-cased.
 *
 * A `WeakSet`, so a declaration that falls out of scope is collectable and tests
 * that build collections per-case do not accumulate policy.
 *
 * **Not a security boundary.** The ledger is a resource collection underneath;
 * anything holding `ctx.resources[id]` can patch a task's state without passing
 * through a `TaskCollectionRef` at all. What this makes true is that every
 * *board-mediated* path to the ledger agrees on the policy instead of disagreeing
 * by construction order.
 */
const immutableAssigneeLedgers = new WeakSet<DefinedTaskCollection>();

/**
 * Freeze the assignee on every task in this ledger, for every ref that resolves
 * it. Called by `taskBoard` when a board binding this collection declares
 * detached workers, whose routing coordinate is derived from the assignee.
 *
 * Idempotent, and deliberately one-way: two boards on one ledger, one detached
 * and one not, must not disagree about whether reassignment is allowed, and the
 * detached board's invariant is the one that breaks silently.
 */
export function freezeLedgerAssignee(collection: DefinedTaskCollection): void {
  immutableAssigneeLedgers.add(collection);
}

/**
 * Is this ledger's assignee frozen? Read at resolution time, never captured at
 * construction time — boards are constructed in an arbitrary order and a board
 * built before the detached one would otherwise close over a stale `false`.
 */
export function hasFrozenLedgerAssignee(collection: DefinedTaskCollection): boolean {
  return immutableAssigneeLedgers.has(collection);
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
