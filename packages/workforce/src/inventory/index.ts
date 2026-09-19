/**
 * The live inventory: org-scoped rows for what is actually open.
 *
 * `collections.ts` owns the explanation — what each collection answers, why
 * there are three, and what the membership index's key shape buys. This file
 * only re-exports.
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
