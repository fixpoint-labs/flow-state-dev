// FIX-2774.
/**
 * The organization's worker inventory as one resource declaration, under one
 * accessor: a block that reads the inventory and the flow that installs it
 * must name the same one. The roster flow declares it, and its inbox view
 * reads it.
 */
import { defineWorkerInventoryCollection } from "./collections";

/** The accessor the inventory is read under. */
export const INVENTORY_RESOURCE = "inventoryWorkers";

/** The inventory's collection, declared once. */
export const inventoryWorkerEntries = defineWorkerInventoryCollection();
