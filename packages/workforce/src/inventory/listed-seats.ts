/**
 * Which seat inventory rows a team list shows: a hired seat's row only while
 * the organization's roster backs it, and a declared seat's row as it is.
 *
 * `fire` removes a hired seat's inventory row, so for a new fire there is
 * nothing to hide. This is the read side of that change (BP-030): rows an
 * earlier version's fire left behind, and the row a crash between fire's two
 * deletes leaves, have no roster row, so they are not listed. Nothing here
 * deletes anything; a reader that sweeps rows at start would race a hire in
 * another process.
 *
 * A leaf (BP-019): its only import is the address split, so a browser panel
 * takes it from `@flow-state-dev/workforce/browser` without the runtime.
 */

import { splitSeatAddress } from "../roster/address";

/**
 * Keep the inventory rows a team list should show.
 *
 * A row is a hired seat's when its id is an address in `orgId`
 * (`<org>.<seatId>`, or `<org>.~<user>.<seatId>`); it is listed only when a
 * roster row names that address. Every other row (a declared seat's, `<team>.<name>`
 * or an org seat's bare id) is listed as it is.
 *
 * Known limit: a declared team whose id equals the organization's reads as
 * hired, the same ambiguity the address split has.
 *
 * @param orgId The organization the rows were read in.
 * @param rows Seat inventory rows, as read.
 * @param roster The organization's roster rows a browser can read (their
 *   `seatId`s), or `undefined` when the roster did not load. With no roster,
 *   no hired seat is listed: a seat the reader can't show is hired isn't shown as hired.
 * @returns the rows to list, in the order given.
 */
export function listedSeatRows<T extends { id: string }>(
  orgId: string,
  rows: readonly T[],
  roster: readonly { seatId: string }[] | undefined
): T[] {
  const backed = new Set((roster ?? []).map((row) => `${orgId}.${row.seatId}`));
  return rows.filter((row) => splitSeatAddress(orgId, row.id) === undefined || backed.has(row.id));
}
