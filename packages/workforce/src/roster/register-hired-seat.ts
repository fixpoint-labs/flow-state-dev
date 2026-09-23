/**
 * The hire writer's register door.
 *
 * Engine `register(flow, { pin })` still admits an unpinned instance, because
 * app and kind flows stay shared. A hired seat is not one of those. This is
 * the function a roster hire, a boot reload, and the seat-hire tools call, and
 * it refuses before that register when the pin is missing.
 *
 * The callback receives the pin as its second argument. The writer wraps the
 * engine door: `(seat, pin) => state.register(seat, { pin })`.
 */

import type { FlowInstance, InstanceOwnerPin } from "@flow-state-dev/core/types";

/**
 * Project a hire row's roster owner into the pin registration requires.
 *
 * @param owner The roster owner. `orgId` is required. `userId` is kept only
 * when it is a non-empty string, so an org-visible row stays org-visible.
 * @throws when `orgId` is missing or empty. An unpinned hired seat is refused
 * rather than admitted as shared.
 */
export function hiredSeatOwnerPinFromRosterOwner(owner: {
  orgId?: string | null;
  userId?: string | null;
}): InstanceOwnerPin {
  if (typeof owner.orgId !== "string" || owner.orgId.length === 0) {
    throw new Error(
      "A hired seat cannot be registered without an owner pin { orgId, userId? } derived from the hire row's roster owner.",
    );
  }
  return typeof owner.userId === "string" && owner.userId.length > 0
    ? { orgId: owner.orgId, userId: owner.userId }
    : { orgId: owner.orgId };
}

/**
 * Admit a hired seat only with a pin from its hire row's roster owner.
 *
 * @param register The writer's register. Called as `register(seat, pin)` and
 * only after the pin is present.
 * @param seat The minted instance. Its address is not read.
 * @param pin The pin from the row. Omitted, or with no `orgId`, this throws
 * and `register` is not called.
 */
export function registerHiredSeat(
  register: (seat: FlowInstance, pin: InstanceOwnerPin) => void,
  seat: FlowInstance,
  pin: InstanceOwnerPin | undefined,
): void {
  register(seat, hiredSeatOwnerPinFromRosterOwner(pin ?? {}));
}
