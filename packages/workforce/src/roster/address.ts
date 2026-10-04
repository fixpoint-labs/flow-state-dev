/**
 * A runtime-hired seat's address: built from an org and a seat id, and split
 * back into the seat id.
 *
 * Split out of `rows.ts`, which re-exports both, so a browser panel can
 * resolve an address without the roster's collection definitions (and through
 * them the `@flow-state-dev/core` root). A leaf on purpose (BP-019): the only
 * import is `@flow-state-dev/core/types` (kept free of Node built-ins by
 * `test/browser-subpath-safe.test.ts`).
 * `@flow-state-dev/workforce/browser` re-exports
 * {@link splitSeatAddress} from here.
 */

import { encodeUserSegment } from "@flow-state-dev/core/types";

/**
 * The address a runtime-hired seat answers on.
 *
 * Org-visible: `<org>.<seatId>`. User-owned: `<org>.~<user>.<seatId>`, with
 * the user escaped. `ownerUserId` comes from the hire row. Nothing here
 * reads a pin out of an address that was already built.
 *
 * Any org id the principal carries is accepted (`org_acme`, the framework's
 * `__fsd_default_org__`). It is escaped the way the user segment is, by
 * {@link orgSegment}, so the leading segment carries no `.` — which is what
 * makes the join injective and therefore reversible by {@link splitSeatAddress}.
 * An org already spelled in lowercase letters, digits and hyphens escapes to
 * itself, so its addresses read as `<org>.<seatId>`. The seat id keeps its own
 * shape: dotted for a team seat (`"<teamId>.<name>"`), bare for an org seat
 * (`"<name>"`). Only the leading segment has to be dot-free.
 *
 * @throws when the org id or the seat id is empty, or the seat id starts with
 * `~` (that marker is the user-owned form).
 */
export function seatAddress(
  orgId: string,
  seatId: string,
  ownerUserId?: string | null,
): string {
  const org = orgSegment(orgId);
  if (seatId.length === 0) {
    throw new Error("A seat id must not be empty — it is half of the seat's address");
  }
  if (seatId.startsWith("~")) {
    throw new Error(
      `seat id "${seatId}" starts with "~", which marks a user-owned seat's address`,
    );
  }
  if (ownerUserId != null && ownerUserId.length > 0) {
    return `${org}.~${encodeUserSegment(ownerUserId)}.${seatId}`;
  }
  return `${org}.${seatId}`;
}

/**
 * An org id as the leading segment of a seat's address: the user segment's
 * escape, applied to the org. Not `validateSegment`: that rule is for names
 * on disk (team, worker and channel folders), which an author chooses. A
 * runtime org id comes from the principal, is opaque, and so is escaped
 * rather than validated. Lowercase letters, digits and `-` pass through;
 * every other character (`_`, `.`, `%`, upper case) is percent-encoded, so the
 * result holds no `.` and two org ids never share one.
 *
 * @throws when the org id is empty.
 */
function orgSegment(orgId: string): string {
  if (orgId.length === 0) {
    throw new Error("An organization id must not be empty — it is the first half of a seat's address");
  }
  return encodeUserSegment(orgId);
}

/**
 * The seat id inside an address this org owns, or `undefined`.
 *
 * One split at the first dot, which is correct only because the escaped org
 * holds no dot. A user-owned address is `<org>.~<user>.<seatId>`; the user
 * segment is skipped and is not returned as an owner. The pin stays on the
 * hire row.
 */
export function splitSeatAddress(orgId: string, address: string): string | undefined {
  if (orgId.length === 0) return undefined;
  const prefix = `${orgSegment(orgId)}.`;
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
