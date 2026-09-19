/**
 * The live inventory: org-scoped rows for what is actually open.
 *
 * `collections.ts` owns the explanation — what each collection answers, why
 * there are three, and what the membership index's key shape buys.
 * `open-inventory.ts` owns the other half: who writes each row, and why the
 * two writers are split the way they are. This file only re-exports.
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
  channelInventoryRowSchema,
  defineChannelInventoryCollection,
  defineMembershipIndexCollection,
  defineSeatInventoryCollection,
  membershipIndexRowSchema,
  membershipKey,
  membershipPrefix,
  seatInventoryRowSchema,
  type ChannelInventoryRow,
  type MembershipIndexRow,
  type SeatInventoryRow
} from "./collections";
