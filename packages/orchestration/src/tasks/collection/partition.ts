/**
 * A task ledger kept per partition: one set of rows per partition value, at the
 * owner's user scope (`defineTaskCollection({ partitionBy })`).
 *
 * The shape a board takes when its rows must cross a flow and still stay its
 * own. A `user`-scoped ledger crosses flows, since every session of the user
 * reads the same scope, but then every session shares one set of rows: one
 * conversation's drain claims, lists and waits on another's tasks. A partition
 * narrows the ledger itself, not a claim filter over it, so **every** operation
 * a ref makes goes through it: list, read, claim, the drain's wake and exit
 * counts, the task tools, change events. A filter at the claim alone holds the
 * claim and leaves the read and the wake open (FIX-1794's POC, leg E1).
 *
 * Orchestration knows no conversation or worker. The composing layer supplies
 * the partition as a function of the running context, and it must read data
 * only the server writes: the value decides whose rows a run touches.
 *
 * ## Key layout
 *
 * A row is stored at `<collection id>/<partition segment>/<task id>`. The
 * segment is the partition value percent-encoded into one path segment
 * (`encodeUserSegment`, injective, so two partitions never share a prefix). A
 * partitioned ref adopts only its partition's **direct** children and refuses a
 * task id that would nest (`/`, or `\`, which the resource layer turns into
 * one): a nested id would be stored where no read of the partition finds it.
 */
import type { JsonObject } from "@flow-state-dev/core";
import type {
  BlockContext,
  ResourceCollectionRef,
  ResourceRef,
} from "@flow-state-dev/core/types";
import { encodeUserSegment, getPatternPrefix } from "@flow-state-dev/core/types";

/**
 * What a partition function sees: the running session's server-set identity,
 * and nothing else (BP-031).
 *
 * Purpose-built rather than a trimmed block context, because a block context
 * carries request input through more than one handle (the parent's `input`,
 * and the `.input` on the sequencer's, the block's own and every target's
 * state ref). A partition read off any of them would let a caller name
 * another conversation's partition. A value the server keeps elsewhere (a
 * session's incarnation) is looked up from these ids; the function may be
 * async.
 */
export interface TaskPartitionContext {
  /** The running session's id. */
  readonly sessionId: string;
  /** The user the session belongs to, whose scope holds the rows. */
  readonly userId: string;
  /** The organization the request runs in, when it has one. */
  readonly orgId?: string;
  /** The tenant the request runs under, when the app is multi-tenant. */
  readonly tenantId?: string;
}

/**
 * Names the partition the running context reads and writes. Must return a
 * non-empty string derived from data only the server writes, and the same
 * value for every run of one owner (a session's id alone is reused when a
 * session is deleted and created again, which would hand the new one the old
 * one's rows).
 */
export type TaskPartitionFn = (ctx: TaskPartitionContext) => string | Promise<string>;

/**
 * Run a ledger's partition function against the running context and check
 * what it returned.
 *
 * @throws when the function returns anything but a non-empty string.
 */
export async function resolveTaskPartition(
  collectionId: string,
  partitionBy: TaskPartitionFn,
  ctx: BlockContext
): Promise<string> {
  const value: unknown = await partitionBy(partitionContextOf(collectionId, ctx));
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `[tasks] ledger "${collectionId}" keeps its rows per partition, and its partitionBy ` +
        `returned ${JSON.stringify(value)}. Return a non-empty string from data only the ` +
        `server writes.`
    );
  }
  return value;
}

/**
 * Copy the server-set identity off the running context into a fresh, frozen
 * object: no reference to the context, or to any handle on it, survives.
 */
function partitionContextOf(collectionId: string, ctx: BlockContext): TaskPartitionContext {
  const identity = ctx.session?.identity;
  // The user scope's `userId`, never its `id`: that is the user record's
  // storage key, which carries the org.
  const userId = identity?.userId ?? ctx.user?.identity?.userId;
  if (identity?.id === undefined || userId === undefined) {
    throw new Error(
      `[tasks] ledger "${collectionId}" keeps its rows per partition, and this context has no ` +
        `session or user to partition by.`
    );
  }
  return Object.freeze({
    sessionId: identity.id,
    userId,
    ...(identity.orgId !== undefined ? { orgId: identity.orgId } : {}),
    ...(identity.tenantId !== undefined ? { tenantId: identity.tenantId } : {}),
  });
}

/**
 * Throw unless `taskId` is one path segment, so the row it names is a direct
 * child of its partition.
 */
function assertPartitionedTaskId(collectionId: string, taskId: string): void {
  if (taskId.length === 0 || taskId.includes("/") || taskId.includes("\\")) {
    throw new Error(
      `[tasks] ledger "${collectionId}" keeps its rows per partition, so a task id must be ` +
        `one path segment: ${JSON.stringify(taskId)} contains a "/" or "\\" (or is empty).`
    );
  }
}

/**
 * One view per (resource collection handle, partition). Shared because the
 * resource backing's task set is keyed by the handle it reads through, and
 * every resolution within one request must read one task set (FIX-990).
 */
const views = new WeakMap<
  ResourceCollectionRef<JsonObject>,
  Map<string, ResourceCollectionRef<JsonObject>>
>();

/**
 * A resource collection handle narrowed to one partition: every key it is
 * given is a task id inside the partition, and `list` returns only the
 * partition's direct children.
 */
export function partitionedResourceCollection(
  inner: ResourceCollectionRef<JsonObject>,
  collectionId: string,
  partition: string
): ResourceCollectionRef<JsonObject> {
  let byPartition = views.get(inner);
  if (byPartition === undefined) {
    byPartition = new Map();
    views.set(inner, byPartition);
  }
  const existing = byPartition.get(partition);
  if (existing !== undefined) return existing;

  const segment = encodeUserSegment(partition);
  const prefix = getPatternPrefix(inner.pattern);

  const keyOf = (key: string | Record<string, string>): string => {
    if (typeof key !== "string") {
      throw new Error(
        `[tasks] ledger "${collectionId}" addresses its rows by task id, not by pattern parameters`
      );
    }
    assertPartitionedTaskId(collectionId, key);
    return `${segment}/${key}`;
  };

  const isDirectChild = (ref: ResourceRef<JsonObject>): boolean => {
    const path =
      prefix.length > 0 && ref.path.startsWith(`${prefix}/`)
        ? ref.path.slice(prefix.length + 1)
        : ref.path;
    if (!path.startsWith(`${segment}/`)) return false;
    const rest = path.slice(segment.length + 1);
    return rest.length > 0 && !rest.includes("/");
  };

  const view: ResourceCollectionRef<JsonObject> = {
    pattern: inner.pattern,
    scope: inner.scope,
    config: inner.config,
    get: (key) => inner.get(keyOf(key)),
    getOptional: (key) => inner.getOptional(keyOf(key)),
    create: (key, initial, options) => inner.create(keyOf(key), initial, options),
    getOrCreate: (key, initial) => inner.getOrCreate(keyOf(key), initial),
    upsert: (key, update, createOnly) => inner.upsert(keyOf(key), update, createOnly),
    delete: (key) => inner.delete(keyOf(key)),
    list: async (within) => (await inner.list(`${segment}/${within ?? ""}`)).filter(isDirectChild),
    count: async () => (await view.list()).length,
  };
  byPartition.set(partition, view);
  return view;
}
