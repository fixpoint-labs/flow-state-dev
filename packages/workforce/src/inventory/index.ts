/**
 * The live inventory: org-scoped rows for the workers registered in this org.
 *
 * `collections.ts` owns the explanation — what the collection answers and who
 * may read it. `open-inventory.ts` owns the boot binder that fills it, and
 * `worker-writer.ts` the action it runs. This file only re-exports.
 */

export {
  INVENTORY_WORKER_WRITER_SESSION,
  openInventory,
  type InventoryActionRequest,
  type InventoryBinding,
  type InventoryRoster,
  type InventoryWorker,
  type InventoryWorkerWriter,
  type OpenInventoryOptions
} from "./open-inventory";

export {
  INVENTORY_REGISTER_WORKERS,
  inventoryWorkersRegisteredSchema,
  inventoryWriterActions
} from "./worker-writer";

export {
  defineWorkerInventoryCollection,
  workerInventoryRowSchema,
  type WorkerInventoryRow
} from "./collections";
