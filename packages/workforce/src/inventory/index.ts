/**
 * The live inventory: org-scoped rows for the seats registered in this org.
 *
 * `collections.ts` owns the explanation — what the collection answers and who
 * may read it. `open-inventory.ts` owns the boot binder that fills it, and
 * `seat-writer.ts` the action it runs. This file only re-exports.
 */

export {
  INVENTORY_SEAT_WRITER_SESSION,
  openInventory,
  type InventoryActionRequest,
  type InventoryBinding,
  type InventoryRoster,
  type InventorySeat,
  type InventorySeatWriter,
  type OpenInventoryOptions
} from "./open-inventory";

export {
  INVENTORY_REGISTER_SEATS,
  inventorySeatsRegisteredSchema,
  inventoryWriterActions
} from "./seat-writer";

export {
  defineSeatInventoryCollection,
  seatInventoryRowSchema,
  type SeatInventoryRow
} from "./collections";
