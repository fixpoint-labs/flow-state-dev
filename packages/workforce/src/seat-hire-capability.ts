/**
 * `createSeatHireCapability` — hire and fire as catalog tools on the existing
 * mint.
 *
 * Compose it into a worker kind's `uses` and the kind's catalog gains `hire`
 * and `fire`. That is a grant the kind offers, not a grant a seat holds: a
 * seat still names the tool in `tools:`, and an empty list stays empty
 * (FIX-1393). The tools mint and retire seats of kinds this factory closed
 * over, write the durable roster, write `inventory/seats/*` so Discover can
 * see the new seat, and register the address. They do not invent a kind, and
 * they do not attach boards.
 *
 * ## Why this is a sibling of `createWorkforceCapability`, not a preset on it
 *
 * That capability's door is a control *because* composing it means "you may
 * ask what is around you." Hire is a grant a seat must name. Different fence,
 * different factory.
 */

import { defineCapability } from "@flow-state-dev/core";
import type { DefinedCapability } from "@flow-state-dev/core";
import { defineHiredRosterCollection } from "./roster/collections";
import { defineSeatInventoryCollection } from "./inventory/collections";
import {
  createSeatHireBlocks,
  HIRED_ROSTER_RESOURCE,
  SEAT_INVENTORY_RESOURCE,
  hiredSeatOwnerPinFromRosterOwner,
  registerHiredSeat,
  type HiredSeatOwnerPin,
  type SeatHireBlocks,
  type SeatHireCapabilityOptions,
} from "./seat-hire-blocks";

/** The capability name a worker file spells under `capabilities:`. */
export const SEAT_HIRE_CAPABILITY = "seat-hire";

/** Re-exported so existing imports of this module keep resolving. */
export {
  createSeatHireBlocks,
  HIRED_ROSTER_RESOURCE,
  SEAT_INVENTORY_RESOURCE,
  hiredSeatOwnerPinFromRosterOwner,
  registerHiredSeat,
  type HiredSeatOwnerPin,
  type SeatHireBlocks,
  type SeatHireCapabilityOptions,
};

/**
 * Build the seat-hire capability.
 *
 * @param options The kinds map, register/unregister, and the optional
 *   allowlist / board ids. Org is never an option — it comes from the
 *   principal at the call.
 * @returns A capability named `seat-hire`, contributing catalog `hire` and
 *   `fire` and installing the roster and seat-inventory collections.
 */
export function createSeatHireCapability(
  options: SeatHireCapabilityOptions,
): DefinedCapability {
  const { hire, fire } = createSeatHireBlocks(options);

  return defineCapability({
    name: SEAT_HIRE_CAPABILITY,
    resources: {
      [HIRED_ROSTER_RESOURCE]: defineHiredRosterCollection(),
      [SEAT_INVENTORY_RESOURCE]: defineSeatInventoryCollection(),
    },
    presets: {
      tools: { tools: [hire, fire] },
      default: ["tools"],
    },
  });
}
