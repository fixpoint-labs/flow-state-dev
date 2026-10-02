/**
 * `removeHiredSeat` — the one removal of a hired seat.
 *
 * Firing a working seat and retiring one that no longer starts are the same
 * fact: this organization no longer employs it. So there is one path, and
 * every caller that removes a hired seat goes through it — `fire` on the
 * seat-hire blocks, and an app's own admin action. One path means its crash
 * and race cases are walked once.
 *
 * **The order is the contract.** The roster row goes first, because the roster
 * is the fact: a leftover roster row would be a seat that still starts. Then
 * the address is released, then the seat's inventory row (keyed by its
 * address) goes. A crash between the two deletes leaves an inventory row with
 * no roster row, which a team list that joins the two hides, and which the
 * next call for the same seat removes, when the row says it was a runtime
 * hire's (`hired: true`).
 *
 * What it never touches: a declared seat's inventory row (one whose address
 * something else holds, or that doesn't say it was hired), the seat's
 * sessions, state and resources, and channel membership rows.
 */

import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { hiredSeatManifestFromStored } from "./rows";

/**
 * What releasing the address found: `released` when this call unregistered the
 * seat, `not-held` when nothing held it here, `held-by-another` when something
 * other than this row's seat holds it (so neither it nor its inventory row is
 * touched).
 */
export type HiredSeatRelease = "released" | "not-held" | "held-by-another";

export interface RemoveHiredSeatOptions {
  /** The organization the call runs under, from the principal. */
  orgId: string;
  /** The roster collection that holds the row. */
  roster: ResourceCollectionRef;
  /** The row's key in that collection. */
  key: string | Record<string, string>;
  /** The seat inventory, whose row for the seat's address is removed. */
  inventory: ResourceCollectionRef;
  /**
   * The address the caller expects the seat at. Used only when there is no
   * roster row, to find a leftover inventory row; a readable row's own
   * address is used otherwise.
   */
  address: string;
  /** Release the address, given the kind the row stored. */
  release: (address: string, storedKind: string) => HiredSeatRelease;
  /**
   * Whether something answers on an address right now. With no roster row, a
   * held address is a seat this path does not own (a declared one), so its
   * inventory row is left alone.
   */
  isHeld: (address: string) => boolean;
}

/** What the removal did. */
export type RemovedHiredSeat =
  /** The roster row was removed, then the address and the inventory row. */
  | { outcome: "removed"; address: string; storedKind: string; released: boolean }
  /** The row could not be read; it was removed by its key, and nothing else was touched. */
  | { outcome: "unreadable"; problem: string }
  /** No roster row, but a hired seat's inventory row was left at the address; it was removed. */
  | { outcome: "already-gone"; address: string }
  /** Nothing of this seat's was found. The caller words the refusal. */
  | { outcome: "nothing"; address: string };

/**
 * Remove one hired seat: roster row, address, inventory row, in that order.
 *
 * @returns what was removed. Never throws over a missing seat; a store that
 *   refuses a write rejects.
 */
export async function removeHiredSeat(options: RemoveHiredSeatOptions): Promise<RemovedHiredSeat> {
  const existing = await options.roster.getOptional(options.key);

  if (existing === undefined) {
    // A crash between the two deletes leaves this. Removed only with positive
    // evidence the row is a runtime hire's: nothing holds the address, and the
    // row itself says `hired: true`. A declared seat's row can sit at the same
    // address (a team named like the org), and a row that predates the field
    // can't say; both are left, and a team list hides the second.
    if (options.isHeld(options.address)) return { outcome: "nothing", address: options.address };
    const leftover = await options.inventory.getOptional(options.address);
    if (leftover === undefined || leftover.state.hired !== true) {
      return { outcome: "nothing", address: options.address };
    }
    await options.inventory.delete(options.address);
    return { outcome: "already-gone", address: options.address };
  }

  const record = hiredSeatManifestFromStored(options.orgId, existing.state);
  if ("problem" in record) {
    // No address can be trusted from a row that does not read, so there is
    // nothing to release and no inventory row that is provably its own.
    await options.roster.delete(options.key);
    return { outcome: "unreadable", problem: record.problem };
  }

  const address = record.manifest.id;
  const storedKind = String(existing.state.flow);
  await options.roster.delete(options.key);
  const release = options.release(address, storedKind);
  if (release !== "held-by-another") {
    await options.inventory.delete(address);
  }
  return { outcome: "removed", address, storedKind, released: release === "released" };
}
