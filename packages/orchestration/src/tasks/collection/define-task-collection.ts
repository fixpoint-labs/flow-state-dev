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

import {
  defineResourceCollection,
  type DefinedResourceCollection,
  type ResourceScope,
} from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";
import { taskSchema } from "../schema/task";
import type { TaskEndingRecorder } from "./ending";
import type { TaskPartitionFn } from "./partition";
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
  readonly __taskCollection: {
    readonly id: string;
    /** Present when the ledger keeps one set of rows per partition. */
    readonly partitionBy?: TaskPartitionFn;
    /** Present when every ending written to the ledger goes through a recorder. */
    readonly recordEnding?: TaskEndingRecorder;
  };
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
   * Give a `session`-scoped board ONE ledger across the session lineage
   * (FIX-1068), so the child session a handed-off row runs in settles against the
   * same rows the dispatching session holds. Without it a session-scoped board
   * hydrates empty inside a child session and the task cannot be settled.
   *
   * Session-scope only — `defineResourceCollection` rejects it at user/org
   * scope, where the ledger already spans every session the principal touches.
   */
  sharedToLineage?: boolean;
  /**
   * Keep one set of rows per partition, at the owner's user scope: a ref
   * resolved in a running context reads and writes only the partition this
   * function names for it. Use it for a board kept per conversation whose rows
   * a task entry on another flow works: the user scope crosses the flow, and
   * the partition keeps each conversation's board its own. A board's hand-off
   * carries the partition it claimed in, so the receiving entry reads the row
   * there and never calls this function itself.
   *
   * Return a non-empty string from data only the server writes. The function
   * gets the running session's server-set identity (`sessionId`, `userId`,
   * `orgId`, `tenantId`) and nothing a caller supplies. `user` scope
   * only, and not with `maxInstances`, whose cap would count every partition's
   * rows. A partitioned ledger's task ids are one path segment (no `/`). Its
   * rows load a partition at a time, on that partition's first read in a
   * request, never the whole ledger when the request starts.
   */
  partitionBy?: TaskPartitionFn;
  /**
   * Hand every write that records how a task ended to this function, inside
   * that same atomic write, and keep the `metadata` it returns on the row: a
   * completion, a failure (for good, or with attempts left), a park, a cancel,
   * and the claim path settling a row whose worker died too often. Whatever it
   * adds lands with the ending or not at all, so a debt the ending creates (a
   * conversation to tell) can't be lost between the two. See `TaskEnding` for
   * what each ending carries.
   *
   * It must be a pure function of the row and the ending: a write that loses a
   * version race runs it again against the fresher row. Only `metadata` is
   * taken from what it returns; the transition decides every other field.
   */
  recordEnding?: TaskEndingRecorder;
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
  if (options.partitionBy !== undefined) assertPartitionable(options);
  if (options.recordEnding !== undefined && typeof options.recordEnding !== "function") {
    throw new Error(
      `[tasks] defineTaskCollection "${options.id}": recordEnding must be a function of the row and its ending`
    );
  }

  // Type the envelope as a bare `ZodTypeAny` before handing it to
  // `defineResourceCollection` so the extended `taskSchema` doesn't inflate the
  // const-generic inference (the `DefinedTaskCollection` return type is
  // hand-declared, so nothing downstream needs the precise inferred shape).
  const envelope: ZodTypeAny = taskEnvelopeSchema(
    (options.stateSchema ?? z.unknown()) as ZodTypeAny
  );

  const collection = defineResourceCollection({
    // `<id>/**` (deep), not `<id>/*`: task ids may contain slashes (a caller can
    // seed `{ id: "parent/child" }`, which the state backing stores
    // fine). A single-level `/*` would reject those keys on a durable board, so
    // the same tasks must round-trip through the resource pattern too.
    pattern: `${options.id}/**`,
    scope: options.scope,
    stateSchema: envelope,
    ...(options.sharedToLineage !== undefined
      ? { sharedToLineage: options.sharedToLineage }
      : {}),
    ...(options.maxInstances !== undefined
      ? { maxInstances: options.maxInstances }
      : {}),
    // A partitioned ledger is never read whole, so it isn't loaded whole when
    // a request starts: each partition's rows load on its first read.
    ...(options.partitionBy !== undefined ? { prefetchMode: "lazy" as const } : {}),
  });

  return Object.assign(collection, {
    __taskCollection: {
      id: options.id,
      ...(options.partitionBy !== undefined ? { partitionBy: options.partitionBy } : {}),
      ...(options.recordEnding !== undefined ? { recordEnding: options.recordEnding } : {}),
    },
  }) as unknown as DefinedTaskCollection;
}

/**
 * Refuse a `partitionBy` the ledger cannot honour, at definition.
 *
 * `user` scope only: that is the scope that crosses a flow and holds one
 * owner's rows, which is what a partition narrows. `maxInstances` is refused
 * because the resource layer counts it across the whole namespace, so one
 * partition's add would be refused, or would evict a row, by another's.
 */
function assertPartitionable(options: DefineTaskCollectionOptions): void {
  const where = `[tasks] defineTaskCollection "${options.id}"`;
  if (typeof options.partitionBy !== "function") {
    throw new Error(`${where}: partitionBy must be a function of the running context`);
  }
  if (options.scope !== "user") {
    throw new Error(
      `${where}: partitionBy keeps one set of rows per partition at the owner's user scope, ` +
        `so the collection must be scope: "user" (got "${options.scope}").`
    );
  }
  if (options.maxInstances !== undefined) {
    throw new Error(
      `${where}: partitionBy cannot be combined with maxInstances, which counts every ` +
        `partition's rows, so one partition's add would be refused or evict a row by another's.`
    );
  }
}

/**
 * Ledgers whose assignee is frozen while an attempt holds a task, keyed by the
 * declaration itself (FIX-982; narrowed to `in_progress` and `parked` by FIX-1780).
 *
 * The policy belongs to the **ledger**, not to a ref. `getOrCreateTaskCollection`
 * builds a fresh wrapper per resolution, so an `immutableAssignee` passed as one
 * wrapper's option guards only the caller that passed it — a second board, or any
 * other resolution of the same collection, gets an unguarded wrapper over the
 * same rows and can reassign a task the handed-off board routes by. Marking the
 * declaration instead means every resolution reads one answer.
 *
 * Keyed by object identity rather than collection id: ids are per-flow strings,
 * and two unrelated flows in one process may both call their collection `tasks`.
 * Within a flow the identity is not a choice — two boards sharing a ledger must
 * pass the same `defineTaskCollection` value, because the resource merge refuses
 * two different references under one accessor key.
 *
 * ## Known limits — declaration identity is not storage identity
 *
 * Both are real and neither is fixable here; see the note below on where the
 * policy would have to live instead.
 *
 * - **Over-reach.** One declaration reused across two flows whose storage does
 *   NOT overlap — a session-scoped collection, or a flow-isolated user/org one —
 *   freezes both, even though their rows are disjoint. A board in the second
 *   flow then declines a `setAssignee` that would have been perfectly safe.
 * - **Under-reach.** Two *separate* declarations of the same id at a
 *   non-isolated user/org scope address the same rows while counting as
 *   different ledgers here, so a freeze on one does not reach the other.
 *
 * Both need the **effective storage binding** — `(scope, ref, flowIsolation,
 * flowKind)` — which is a per-flow fact. Nothing on this path can see it:
 * `taskBoard()` runs before, and independently of, the `defineFlow` that will
 * contain it, and `BlockContext` carries no flow identity at resolution time
 * either. Fixing it properly means the policy riding the flow's resource
 * installation rather than a side table, which is a change to the resource
 * contract and not this module's to make.
 *
 * The behaviour chosen in the meantime fails **closed**: an unnecessary decline
 * is visible immediately and recoverable by giving the second flow its own
 * declaration, where a missed freeze silently strands handed-off work.
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
 * Freeze the assignee on every task an attempt holds (`in_progress` or
 * `parked`) in this ledger, for every ref that resolves it. Called by `taskBoard` when a board binding this collection declares
 * dispatcher seats, whose child's routing key is derived from the assignee.
 *
 * Idempotent, and deliberately one-way: two boards on one ledger, one handing
 * off and one not, must not disagree about whether reassignment is allowed, and
 * the handed-off board's invariant is the one that breaks silently.
 */
export function freezeLedgerAssignee(collection: DefinedTaskCollection): void {
  immutableAssigneeLedgers.add(collection);
}

/**
 * Is this ledger's assignee frozen? Read at resolution time, never captured at
 * construction time — boards are constructed in an arbitrary order and a board
 * built before the handed-off one would otherwise close over a stale `false`.
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
