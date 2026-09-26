/**
 * A runtime-hired seat's address: built from an org and a seat id, and split
 * back into the seat id.
 *
 * Split out of `rows.ts`, which re-exports both, so a browser panel can
 * resolve an address without the roster's collection definitions (and through
 * them the `@flow-state-dev/core` root). A leaf on purpose (BP-019): the only
 * imports are `@flow-state-dev/core/types` and `../loader/segments`, which
 * imports nothing. `@flow-state-dev/workforce/browser` re-exports
 * {@link splitSeatAddress} from here.
 */

import { encodeUserSegment } from "@flow-state-dev/core/types";
import { validateSegment } from "../loader/segments";

/**
 * The address a runtime-hired seat answers on.
 *
 * Org-visible: `<org>.<seatId>`. User-owned: `<org>.~<user>.<seatId>`, with
 * the user escaped. `ownerUserId` comes from the hire row. Nothing here
 * reads a pin out of an address that was already built.
 *
 * The org is validated as one address segment, so it carries no `.` — which
 * is what makes the join injective and therefore reversible by
 * {@link splitSeatAddress}. The seat id stays dotted on purpose
 * (`"<teamId>.<name>"`). Only the leading segment has to be dot-free.
 *
 * @throws when the org id is not a legal address segment, the seat id is
 * empty, or the seat id starts with `~` (that marker is the user-owned form).
 */
export function seatAddress(
  orgId: string,
  seatId: string,
  ownerUserId?: string | null,
): string {
  validateSegment(orgId, "Org");
  if (seatId.length === 0) {
    throw new Error("A seat id must not be empty — it is half of the seat's address");
  }
  if (seatId.startsWith("~")) {
    throw new Error(
      `seat id "${seatId}" starts with "~", which marks a user-owned seat's address`,
    );
  }
  if (ownerUserId != null && ownerUserId.length > 0) {
    return `${orgId}.~${encodeUserSegment(ownerUserId)}.${seatId}`;
  }
  return `${orgId}.${seatId}`;
}

/**
 * The inverse of {@link seatAddress}: recover the org and the seat id from an
 * address, or `undefined` when the address does not belong to this org.
 *
 * One split at the FIRST dot, which is correct only because the org is a
 * validated segment. Splitting at the last dot, or splitting on every dot,
 * would mangle every ordinary `"<teamId>.<name>"` seat id.
 */
/**
 * The seat id inside an address this org owns, or `undefined`.
 *
 * One split at the first dot, which is correct only because the org is a
 * validated segment. A user-owned address is `<org>.~<user>.<seatId>`; the
 * user segment is skipped and is not returned as an owner. The pin stays on
 * the hire row.
 */
export function splitSeatAddress(orgId: string, address: string): string | undefined {
  const prefix = `${orgId}.`;
  if (!address.startsWith(prefix)) return undefined;
  const rest = address.slice(prefix.length);
  if (rest.startsWith("~")) {
    const dot = rest.indexOf(".");
    if (dot <= 1 || dot === rest.length - 1) return undefined;
    const seatId = rest.slice(dot + 1);
    return seatId.length > 0 ? seatId : undefined;
  }
  return rest.length > 0 ? rest : undefined;
}
