/**
 * Which partitions of a partitioned ledger hold a task id, answered by the
 * ledger's declared `byTaskId` index (FIX-2532, amending FIX-2160 D1).
 *
 * A partitioned ledger stores a row at `<ledger id>/<partition segment>/<task
 * id>`, so a bare task id names no row until its partition is known, and
 * listing the whole ledger to find one would load every partition's rows
 * (BP-033). `defineTaskCollection({ partitionBy })` declares `byTaskId` on the
 * ledger, so the engine writes each row's entry in the row's own write, and
 * `findBy` reads it across the partitions, which share one user cell. On a
 * store without index verbs `findBy` scans the cell instead: the same rows,
 * slower.
 *
 * Rows an older release wrote carry no entries; the first lookup in a scope
 * builds the index from the rows it finds. That release also kept a marker
 * collection beside the ledger (`<ledger id>__ids/**`). Nothing reads or
 * writes it now: its rows are left in the store (BP-030).
 *
 * Orchestration knows no conversation: this answers partitions, and the
 * composing layer decides what an id held in more than one means.
 */
import { getPatternPrefix, type BlockContext } from "@flow-state-dev/core/types";
import { isDefinedTaskCollection, TASK_ID_INDEX } from "./define-task-collection";
import { resolveResourceCollection } from "./resolve-resource-collection";

/**
 * The partitions of ledger `ledgerId` that hold `taskId`, at the running
 * user's scope: none, one, or (for an id a caller picked twice) several.
 * Partitions only; the caller reads the row in the one it means.
 *
 * @throws when the running flow does not install the ledger, or installs one
 *   that is not kept per partition.
 */
export async function findTaskPartitions(
  ctx: BlockContext,
  ledgerId: string,
  taskId: string
): Promise<string[]> {
  if (taskId.length === 0) return [];
  const ledger = resolveResourceCollection(ctx, ledgerId);
  if (ledger === undefined) {
    throw new Error(`[tasks] findTaskPartitions: this flow does not install the ledger "${ledgerId}".`);
  }
  const declared = ledger.config;
  if (!isDefinedTaskCollection(declared) || declared.__taskCollection.partitionBy === undefined) {
    throw new Error(
      `[tasks] findTaskPartitions: ledger "${ledgerId}" does not keep its rows per partition (partitionBy).`
    );
  }
  const prefix = `${getPatternPrefix(ledger.pattern)}/`;
  const partitions = new Set<string>();
  for (const row of await ledger.findBy(TASK_ID_INDEX, taskId)) {
    // `<partition segment>/<task id>`: a row of one partition, never a nested key.
    const [segment, id, ...rest] = row.path.slice(prefix.length).split("/");
    if (!row.path.startsWith(prefix) || segment === undefined || id !== taskId || rest.length > 0) continue;
    partitions.add(decodeURIComponent(segment));
  }
  return [...partitions];
}
