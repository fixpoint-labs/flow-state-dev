/**
 * The hire writer's register door.
 *
 * Engine `register(flow, { pin })` still admits an unpinned instance, because
 * app and kind flows stay shared. A hired seat is not one of those. This
 * refuses before that register when the pin is missing.
 */

import type { FlowInstance, InstanceOwnerPin } from "@flow-state-dev/core/types";
import { hiredSeatOwnerPin } from "./rows";

/**
 * Admit a hired seat only with a pin from its hire row.
 *
 * A blank `userId` is dropped, so the seat stays org-visible. Missing
 * `orgId` throws, and `register` is not called.
 *
 * @param register Called as `register(seat, pin)` only after the pin is present.
 */
export function registerHiredSeat(
  register: (seat: FlowInstance, pin: InstanceOwnerPin) => void,
  seat: FlowInstance,
  pin: InstanceOwnerPin | undefined,
): void {
  if (typeof pin?.orgId !== "string" || pin.orgId.length === 0) {
    throw new Error(
      "A hired seat cannot be registered without an owner pin { orgId, userId? } derived from the hire row's roster owner.",
    );
  }
  register(seat, hiredSeatOwnerPin(pin.orgId, { ownerUserId: pin.userId ?? null }));
}
