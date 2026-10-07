/**
 * A skills collection kept per partition: one catalog per partition value, in
 * the collection's one storage bucket (`createSkillsLibrary({ partitionBy })`).
 *
 * The shape of the task ledger's partition (`tasks/collection/partition.ts`),
 * for the skills library. A library declared on a flow that many parties run
 * through one registered copy would otherwise give them one catalog: flow
 * isolation keys a bucket on the flow instance, and one instance is one
 * bucket. The composing layer names the party per run, from data only the
 * server writes; orchestration names no party and knows nothing of who it is.
 *
 * ## Key layout
 *
 * An entry is stored at `<prefix>/<partition segment>/<skill key>`. The segment
 * is the partition value percent-encoded into one path segment
 * (`encodeUserSegment`, injective). The partitioned view reports its pattern as
 * `<prefix>/<segment>/**`, so every reader that strips the pattern's prefix off
 * a stored path gets back the key it would have without a partition.
 */
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { encodeUserSegment, getPatternPrefix } from "@flow-state-dev/core/types";
import { resolveResourceCollection } from "../tasks/collection/resolve-resource-collection";

/**
 * Names the partition a run reads and writes its skills catalog in. Returns a
 * non-empty string derived from data only the server writes, or `undefined`
 * for a run with no partition, which reads the collection unpartitioned.
 * Synchronous: it runs on every read of the catalog.
 */
export type SkillsPartitionFn = (ctx: BlockContext) => string | undefined;

/** The marker a partitioned skills collection carries on its definition. */
export const SKILLS_PARTITION_KEY = "__skillsPartition" as const;

/** One view per (collection handle, partition), so one run shares one view. */
const views = new WeakMap<ResourceCollectionRef, Map<string, ResourceCollectionRef>>();

/**
 * A skills collection handle narrowed to one partition. Every key it is given
 * is a key inside the partition, and `list` returns only the partition's
 * entries.
 */
export function partitionedSkillsCollection(
  inner: ResourceCollectionRef,
  partition: string,
): ResourceCollectionRef {
  let byPartition = views.get(inner);
  if (byPartition === undefined) {
    byPartition = new Map();
    views.set(inner, byPartition);
  }
  const existing = byPartition.get(partition);
  if (existing !== undefined) return existing;

  const segment = encodeUserSegment(partition);
  const prefix = getPatternPrefix(inner.pattern);
  const inside = prefix.length > 0 ? `${prefix}/${segment}/` : `${segment}/`;

  const keyOf = (key: string | Record<string, string>): string => {
    if (typeof key !== "string") {
      throw new Error("[skills] a partitioned skills collection addresses entries by key, not by pattern parameters");
    }
    return `${segment}/${key}`;
  };

  const view: ResourceCollectionRef = {
    pattern: `${inside}**`,
    scope: inner.scope,
    config: inner.config,
    get: (key) => inner.get(keyOf(key)),
    getOptional: (key) => inner.getOptional(keyOf(key)),
    create: (key, initial, options) => inner.create(keyOf(key), initial, options),
    getOrCreate: (key, initial) => inner.getOrCreate(keyOf(key), initial),
    upsert: (key, update, createOnly) => inner.upsert(keyOf(key), update, createOnly),
    delete: (key) => inner.delete(keyOf(key)),
    list: async (within) => {
      const rows = await inner.list(`${segment}/${within ?? ""}`);
      return rows.filter((ref) => ref.path.startsWith(inside));
    },
    count: async () => (await view.list()).length,
  };
  byPartition.set(partition, view);
  return view;
}

/**
 * Resolve the skills collection under `key` for this run: the collection
 * itself, or its partition when its library was created with `partitionBy`.
 * Every skills runtime read goes through here, so no reader can reach another
 * partition's catalog by resolving the collection directly.
 */
export function resolveSkillsCollection(
  ctx: BlockContext,
  key: string,
): ResourceCollectionRef | undefined {
  const collection = resolveResourceCollection(ctx, key);
  if (collection === undefined) return undefined;
  const partitionBy = (collection.config as { [SKILLS_PARTITION_KEY]?: SkillsPartitionFn } | undefined)?.[
    SKILLS_PARTITION_KEY
  ];
  if (typeof partitionBy !== "function") return collection;
  const partition = partitionBy(ctx);
  if (partition === undefined) return collection;
  if (typeof partition !== "string" || partition.length === 0) {
    throw new Error(
      `[skills] collection "${key}" keeps its catalog per partition, and its partitionBy returned ` +
        `${JSON.stringify(partition)}. Return a non-empty string from data only the server writes, ` +
        `or undefined for no partition.`,
    );
  }
  return partitionedSkillsCollection(collection, partition);
}
