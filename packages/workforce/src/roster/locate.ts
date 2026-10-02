/**
 * Which roster row a seat id names for the caller: the one place that decides
 * which row `fire` and `rehire` act on, and which an app's own fire reuses.
 *
 * A caller can hold two rows under one seat id: the organization's, and their
 * own user-owned one on the owner-private roster. `owner` names which; without
 * it, the only row under the id is the one, and two is a refusal rather than
 * a guess.
 */

import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { encodeUserSegment, seatAddress } from "./rows";

/** Whose roster row a seat id names: the organization's, or the caller's own. */
export type HiredSeatOwner = "organization" | "me";

/** Where one seat's roster row is, and whose it is. */
export interface HiredSeatLocation {
  /** The roster collection holding the row. */
  roster: ResourceCollectionRef;
  /** The row's key in that collection. */
  key: string | Record<string, string>;
  /** The member a user-owned row belongs to; `null` for an org row. */
  ownerUserId: string | null;
}

/** What `resolveHiredSeatLocation` reads. */
export interface ResolveHiredSeatLocationOptions {
  seatId: string;
  /** Which row. Omitted, the only row under the id. */
  owner?: HiredSeatOwner;
  /** The organization's roster. */
  roster: ResourceCollectionRef;
  /** The user-owned roster, when the flow mounts it. */
  privateRoster?: ResourceCollectionRef;
  /** The caller, from the verified session. */
  userId?: string;
  /**
   * For a fire's retry: when the caller has no user-owned row and names no
   * owner, a hired inventory row at the caller's user-owned address (the one
   * a fire leaves when it stops after deleting that row) keeps the seat the
   * caller's, ahead of any org row, so the retry removes that row rather than
   * firing an org seat that shares the id.
   */
  leftoverAt?: { orgId: string; inventory: ResourceCollectionRef };
}

/**
 * Find a seat's roster row (present or not).
 *
 * `owner: "organization"` is the org's row. `owner: "me"` is the caller's own
 * user-owned row, and is refused when there is no user-owned roster or no
 * caller. Without `owner`: the caller's own row when only it exists, the org
 * row when only it exists, and a refusal naming both when both do.
 *
 * @throws when `owner: "me"` has no user-owned roster to name, or when no
 *   `owner` is given and the caller has both rows under the seat id.
 */
export async function resolveHiredSeatLocation(options: ResolveHiredSeatLocationOptions): Promise<HiredSeatLocation> {
  const { seatId, owner, privateRoster, userId, leftoverAt } = options;
  const org: HiredSeatLocation = { roster: options.roster, key: seatId, ownerUserId: null };
  if (owner === "organization") return org;
  if (privateRoster === undefined || typeof userId !== "string" || userId.length === 0) {
    if (owner === "me") {
      throw new Error(`"${seatId}" can't be yours here: this flow keeps no user-owned roster for this caller.`);
    }
    return org;
  }
  const own: HiredSeatLocation = {
    roster: privateRoster,
    key: { owner: `~${encodeUserSegment(userId)}`, seat: seatId },
    ownerUserId: userId,
  };
  if (owner === "me") return own;
  if ((await privateRoster.getOptional(own.key)) !== undefined) {
    if ((await org.roster.getOptional(org.key)) !== undefined) {
      throw new Error(
        `"${seatId}" names two seats: the organization's and yours. ` +
          `Say which with owner: "organization" or owner: "me".`
      );
    }
    return own;
  }
  if (leftoverAt === undefined) return org;
  // Probed before the org row: an org seat can share the seat id, and a retry
  // that fell through to it would fire that seat instead.
  const leftover = await leftoverAt.inventory.getOptional(seatAddress(leftoverAt.orgId, seatId, userId));
  return leftover?.state.hired === true ? own : org;
}
