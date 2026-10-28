/**
 * Which partitions of a partitioned ledger hold a task id: the ledger's id
 * index (FIX-2160 D1).
 *
 * A partitioned ledger stores a row at `<ledger id>/<partition>/<task id>`, so
 * a bare task id names no row until its partition is known, and listing the
 * whole ledger to find one would load every partition's rows (BP-033). The
 * index is the missing read: one marker per (task id, partition), kept at the
 * ledger's own scope in a collection of its own, and written by the ledger's
 * own add, before the row (`createTask` / `createTasks` in `./resource-backed`), the
 * one path every filing passes. A marker without a row (the row's create
 * failed after it) answers a lookup that then finds no row, never a wrong one.
 *
 * ## Key layout
 *
 * A marker is stored at `<ledger id>__ids/<task id segment>/<partition
 * segment>`, each segment percent-encoded with `encodeUserSegment` (injective,
 * no `/`). One marker per pair, so two partitions filing the same id never
 * overwrite each other (ids a caller picks are unique per partition only), and
 * every write is a create of its own key, with nothing to merge.
 *
 * Orchestration knows no conversation: the index answers partitions, and the
 * composing layer decides what an id held in more than one means.
 */
import { z } from "zod";
import type { JsonObject } from "@flow-state-dev/core";
import {
  defineResourceCollection,
  encodeUserSegment,
  type BlockContext,
  type DefinedResourceCollection,
  type ResourceCollectionRef,
  type ResourceScope,
} from "@flow-state-dev/core/types";
import { resolveResourceCollection } from "./resolve-resource-collection";

/** The resource key a partitioned ledger's id index is installed under. */
export function taskIdIndexKey(ledgerId: string): string {
  return `${ledgerId}__ids`;
}

const markerSchema = z.object({ partition: z.string().min(1) });

/** Declare the id index of the partitioned ledger `ledgerId`, at its scope. */
export function defineTaskIdIndex(ledgerId: string, scope: ResourceScope): DefinedResourceCollection {
  return defineResourceCollection({
    pattern: `${taskIdIndexKey(ledgerId)}/**`,
    scope,
    stateSchema: markerSchema,
    // Read one id at a time, never whole, and from whichever flow files or
    // looks up, as its ledger is.
    prefetchMode: "lazy",
    flowIsolation: false,
  }) as unknown as DefinedResourceCollection;
}

function markerPrefix(taskId: string): string {
  return `${encodeUserSegment(taskId)}/`;
}

/**
 * The running context's handle on the id index of `ledgerId`.
 *
 * @throws when the running flow installs the ledger without its index: a row
 *   filed there would be one no lookup finds.
 */
export function resolveTaskIdIndex(ctx: BlockContext, ledgerId: string): ResourceCollectionRef<JsonObject> {
  const key = taskIdIndexKey(ledgerId);
  const index = resolveResourceCollection(ctx, key);
  if (index === undefined) {
    throw new Error(
      `[tasks] ledger "${ledgerId}" keeps its rows per partition, and this flow installs it ` +
        `without its id index at ctx.resources["${key}"]. Install both with ` +
        `taskLedgerResources(ledger).`
    );
  }
  return index;
}

/** Record that `partition` holds `taskId`. Idempotent. */
export async function recordTaskIdPartition(
  index: ResourceCollectionRef<JsonObject>,
  taskId: string,
  partition: string
): Promise<void> {
  await index.getOrCreate(`${markerPrefix(taskId)}${encodeUserSegment(partition)}`, { partition });
}

/**
 * The partitions of ledger `ledgerId` that hold `taskId`, at the running
 * user's scope: none, one, or (for an id a caller picked twice) several.
 * Partitions only; the caller reads the row in the one it means.
 */
export async function findTaskPartitions(
  ctx: BlockContext,
  ledgerId: string,
  taskId: string
): Promise<string[]> {
  if (taskId.length === 0) return [];
  const markers = await resolveTaskIdIndex(ctx, ledgerId).list(markerPrefix(taskId));
  const partitions = new Set<string>();
  for (const marker of markers) {
    const parsed = markerSchema.safeParse(marker.state);
    if (parsed.success) partitions.add(parsed.data.partition);
  }
  return [...partitions];
}
