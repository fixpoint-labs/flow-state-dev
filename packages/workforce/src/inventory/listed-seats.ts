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
 * A row is a hired seat's when it says so (`hired: true`); it is listed only
 * when a roster row names its address. A row that says `hired: false` is a
 * declared seat's and is listed as it is, even when its team shares the
 * organization's name. A row written before rows said where they came from
 * (`hired` null or absent) is read by its id's shape: an address in `orgId`
 * (`<org>.<seatId>`, or `<org>.~<user>.<seatId>`) counts as hired.
 *
 * @param orgId The organization the rows were read in.
 * @param rows Seat inventory rows, as read, with their `hired` field when they carry one.
 * @param roster The organization's roster rows a browser can read (their
 *   `seatId`s), or `undefined` when the roster did not load. With no roster,
 *   no hired seat is listed: a seat the reader can't show is hired isn't shown as hired.
 * @returns the rows to list, in the order given.
 */
export function listedSeatRows<T extends { id: string; hired?: boolean | null }>(
  orgId: string,
  rows: readonly T[],
  roster: readonly { seatId: string }[] | undefined
): T[] {
  const backed = new Set((roster ?? []).map((row) => `${orgId}.${row.seatId}`));
  return rows.filter((row) => !isHiredSeatRow(orgId, row) || backed.has(row.id));
}

/**
 * Whether an inventory row is a runtime hire's: what the row says, or, for a
 * row that predates `hired`, whether its id is an address in `orgId` (BP-030).
 */
export function isHiredSeatRow(orgId: string, row: { id: string; hired?: boolean | null }): boolean {
  return row.hired == null ? splitSeatAddress(orgId, row.id) !== undefined : row.hired;
}
