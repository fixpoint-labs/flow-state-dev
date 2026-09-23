/**
 * Admission for a hired flow instance.
 *
 * The pin is `{ orgId, userId? }`, stamped on the instance from the hire row.
 * It is never read off the address. A shared instance has no pin and is not
 * asked. HTTP entry points answer a mismatch as an unknown flow, before
 * anything is written. {@link refuseInstancePin} is the net under every other
 * door, and it runs before any block.
 */
import type { InstanceOwnerPin } from "@flow-state-dev/core/types";

/** Who is asking to see or run the instance. Both fields come from a resolved principal or a bound session. */
export interface InstancePinCaller {
  userId: string;
  orgId: string;
}

/**
 * Thrown when a bound session is outside the instance's pin.
 *
 * The message names the instance and the axis that failed. It does not name
 * the seat's configuration. `reason` is which check refused, so a caller who
 * matches the user and misses the organization is not reported as a user miss.
 */
export class InstancePinMismatchError extends Error {
  readonly flowId: string;
  readonly reason: "owning-org" | "roster-owner";

  constructor(flowId: string, reason: "owning-org" | "roster-owner") {
    super(
      reason === "owning-org"
        ? `Flow instance "${flowId}" is not admitted for this organization.`
        : `Flow instance "${flowId}" is not admitted for this user.`
    );
    this.name = "InstancePinMismatchError";
    this.flowId = flowId;
    this.reason = reason;
  }
}

/** Which half of a pin the caller missed. Organization is compared first. */
export type PinMismatchReason = "owning-org" | "roster-owner";

/**
 * Which half of `pin` `caller` misses, or `undefined` when the caller is inside
 * the pin or there is no pin.
 *
 * Organization is compared first, so a caller who matches the user and misses
 * the organization is not reported as a user miss.
 */
export function pinMismatchReason(
  pin: InstanceOwnerPin | undefined,
  caller: InstancePinCaller
): PinMismatchReason | undefined {
  if (pin === undefined) return undefined;
  if (pin.orgId !== caller.orgId) return "owning-org";
  if (pin.userId !== undefined && pin.userId !== caller.userId) return "roster-owner";
  return undefined;
}

/**
 * Whether `caller` is outside `pin`.
 *
 * @returns `false` when there is no pin. Organization is compared first.
 */
export function pinRejectsCaller(
  pin: InstanceOwnerPin | undefined,
  caller: InstancePinCaller
): boolean {
  return pinMismatchReason(pin, caller) !== undefined;
}

/**
 * The answer a fresh HTTP entry gives a pinned instance the caller is outside.
 *
 * Same sentence an unregistered address gets, so the two cannot be told apart.
 */
export function unknownFlowMessage(flowId: string): string {
  return `Unknown flow "${flowId}"`;
}

/**
 * An address this process will not run for this caller.
 *
 * Thrown for an address the registry does not hold and for a pin the caller
 * is outside. The message is {@link unknownFlowMessage}. Callers match on the
 * class, so a wording change stays a 404.
 */
export class UnknownFlowError extends Error {
  readonly flowId: string;

  constructor(flowId: string) {
    super(unknownFlowMessage(flowId));
    this.name = "UnknownFlowError";
    this.flowId = flowId;
  }
}

/**
 * Refuse a run whose session is outside the instance pin.
 *
 * No-op for a shared instance. Call after the session's own org binding, and
 * before any block.
 */
export function refuseInstancePin(
  flow: { id: string; ownerPin?: InstanceOwnerPin },
  caller: InstancePinCaller
): void {
  const reason = pinMismatchReason(flow.ownerPin, caller);
  if (reason !== undefined) throw new InstancePinMismatchError(flow.id, reason);
}
