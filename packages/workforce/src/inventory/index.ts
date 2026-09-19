/**
 * The live inventory: org-scoped rows for what is actually open, beside the
 * declared layer that says what a tree wrote down.
 *
 * Node-free, like the rest of this package's root — nothing here reads a
 * folder. The rows are written by the layers that hold the live answer and read
 * by any flow in the same org.
 */

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
