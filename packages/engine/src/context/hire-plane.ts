/**
 * The hire plane: admission for a hired flow instance, and the fence around
 * Workforce's user-owned roster rows.
 *
 * The pin is `{ orgId, userId? }`, stamped on the instance from the hire row.
 * It is never read off the address. A shared instance has no pin and is not
 * asked. HTTP entry points answer a mismatch as an unknown flow, before
 * anything is written. {@link refuseInstancePin} is the net under every other
 * door, and it runs before any block.
 *
 * A user-owned roster row, stored under `workforce/roster/~<user>/`, has two
 * fences here, and this module is their only owner. The key fence
 * ({@link privateRosterAdmits}) is always on: every read path asks it, and it
 * serves such a row only through the branded private writer, to its owner.
 * The startup fence ({@link admitRosterCollections}) is armed per registry by
 * the writer's registration and refuses any collection whose pattern could
 * reach those rows.
 */
import type { InstanceOwnerPin } from "@flow-state-dev/core/types";
import {
  encodeUserSegment,
  HIRED_ROSTER_BROWSER_PATTERN,
  HIRED_ROSTER_PRIVATE_PATTERN,
  isHiredRosterPrivateCollection,
} from "@flow-state-dev/core/types";

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

/**
 * Whether `storageKey` is a user-owned roster row: `workforce/roster/~<user>/…`.
 *
 * That is the shape the private roster writer stores a user-owned hired seat
 * under. The key decides it, not the collection or what is registered, so the
 * answer is the same in every process over the store.
 */
function isUserOwnedRosterKey(storageKey: string): boolean {
  return /^workforce\/roster\/~[^/]+\//.test(storageKey);
}

/**
 * Whether `userId` may see the row at `storageKey` of `collection`.
 *
 * A user-owned roster row is served only through the branded private roster
 * writer, and only to the user it belongs to. Every other collection is refused
 * every such key, whatever its pattern and whatever the process registered.
 * Through the writer, a missing user sees none. Any other key is admitted to
 * any collection except the writer, which holds nothing else.
 *
 * The resource handle, the browser resource routes and the debug endpoints all
 * ask this, so every read path keeps the plane the handle keeps. The user id is
 * escaped the same way the stored key is, so `bob` is not a prefix of `bob/x`.
 */
export function privateRosterAdmits(
  collection: object,
  storageKey: string,
  userId: string | undefined
): boolean {
  if (!isHiredRosterPrivateCollection(collection)) return !isUserOwnedRosterKey(storageKey);
  if (userId === undefined || userId.length === 0) return false;
  return storageKey.startsWith(`workforce/roster/~${encodeUserSegment(userId)}/`);
}

/**
 * The refusal a fenced key gets on a write or a by-name `get`. It does not say
 * whether the row exists.
 */
export const HIRED_SEAT_ROW_REFUSAL = "A hired-seat row is readable only by the user it belongs to.";

/** A segment that can stand in for `literal`: the literal itself, a parameter, or a wildcard. */
function segmentOpens(segment: string, literal: string): boolean {
  return (
    segment === literal ||
    segment === "*" ||
    segment === "**" ||
    /^\[[a-zA-Z0-9_]+\]$/.test(segment)
  );
}

/**
 * Whether `pattern` can resolve onto a user-owned roster key.
 *
 * The browser pattern is one segment under the roster. The private writer is
 * exactly two, and is excluded here: admission of that one pattern is the
 * brand check. A parameter or `*` in the first segment can be `workforce`,
 * and the same in the second can be `roster`, so `workforce/[r]/[owner]/[seat]`
 * and `[a]/[b]/[c]/[d]` reach `workforce/roster/~user/seat`. Two or more
 * segments after that pair, or a `**` that consumes the rest, is enough.
 */
function rosterPatternOverlapsPrivate(pattern: string): boolean {
  if (pattern === HIRED_ROSTER_BROWSER_PATTERN || pattern === HIRED_ROSTER_PRIVATE_PATTERN) {
    return false;
  }
  const segments = pattern.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return false;
  if (segments[0] === "**") return true;
  if (!segmentOpens(segments[0]!, "workforce")) return false;
  if (segments.length === 1) return false;
  if (segments[1] === "**") return true;
  if (!segmentOpens(segments[1]!, "roster")) return false;
  const rest = segments.slice(2);
  if (rest.some((segment) => segment === "**")) return true;
  return rest.length >= 2;
}

/**
 * Whether a collection's handle has to ask {@link privateRosterAdmits}: the
 * branded writer, or any collection whose pattern can resolve onto a
 * user-owned roster key. Every other collection cannot reach one, so it is
 * served unwrapped.
 */
export function collectionReachesUserOwnedRows(collection: { pattern: string }): boolean {
  return (
    isHiredRosterPrivateCollection(collection) ||
    collection.pattern === HIRED_ROSTER_PRIVATE_PATTERN ||
    rosterPatternOverlapsPrivate(collection.pattern)
  );
}

/** A collection declaration as registration sees it. */
type RosterCandidate = { pattern: string; client?: { state?: { read?: boolean } } };

/** The collection entries of a flow's resources: anything carrying a string `pattern`. */
function rosterCandidates(resources: Record<string, unknown> | undefined): RosterCandidate[] {
  if (resources === undefined) return [];
  const out: RosterCandidate[] = [];
  for (const entry of Object.values(resources)) {
    if (typeof entry !== "object" || entry === null) continue;
    if (typeof (entry as { pattern?: unknown }).pattern !== "string") continue;
    out.push(entry as RosterCandidate);
  }
  return out;
}

/** Whether a flow's resources include Workforce's branded private roster writer. */
function declaresPrivateRosterWriter(flow: { resources?: Record<string, unknown> }): boolean {
  return rosterCandidates(flow.resources).some((entry) => isHiredRosterPrivateCollection(entry));
}

/**
 * Refuse a collection an armed registry must not admit.
 *
 * The private writer pattern is admitted only with the brand, and never with a
 * browser read. Any other pattern that can resolve onto a user-owned roster
 * row is refused. The browser roster is always admitted.
 */
function assertRosterCollectionAdmitted(config: RosterCandidate): void {
  const { pattern } = config;
  if (pattern === HIRED_ROSTER_BROWSER_PATTERN) return;
  if (pattern === HIRED_ROSTER_PRIVATE_PATTERN) {
    if (config.client?.state?.read === true) {
      throw new Error(
        `Collection pattern "${pattern}" must not enable a browser read. ` +
          `User-owned roster rows stay off the browser collection.`
      );
    }
    if (!isHiredRosterPrivateCollection(config)) {
      throw new Error(
        `Collection pattern "${pattern}" is the workforce roster writer and cannot be redeclared. ` +
          `User-owned roster rows are read through the hire and fire helpers, for the caller only.`
      );
    }
    return;
  }
  if (!rosterPatternOverlapsPrivate(pattern)) return;
  throw new Error(
    `Collection pattern "${pattern}" can read user-owned roster rows on the server. ` +
      `Declare "${HIRED_ROSTER_BROWSER_PATTERN}" for the org roster. ` +
      `A deep pattern such as "workforce/roster/**" is refused.`
  );
}

/**
 * The startup fence, for one registration.
 *
 * Unarmed and without the writer, the flow is not checked. When the incoming
 * flow carries the writer, or the registry is already armed, the incoming flow
 * is checked; when it is the incoming flow that arms the registry, every held
 * flow is checked too, and a refusal there names the held flow. Throws before
 * the caller mutates anything.
 *
 * @returns whether the registry is armed once this flow is admitted.
 */
export function admitRosterCollections(
  incoming: { resources?: Record<string, unknown> },
  held: Iterable<{ id: string; resources?: Record<string, unknown> }>,
  armed: boolean
): boolean {
  const arms = declaresPrivateRosterWriter(incoming);
  if (!arms && !armed) return false;
  for (const entry of rosterCandidates(incoming.resources)) assertRosterCollectionAdmitted(entry);
  if (!armed) {
    for (const flow of held) {
      for (const entry of rosterCandidates(flow.resources)) {
        try {
          assertRosterCollectionAdmitted(entry);
        } catch (error) {
          throw new Error(
            `${(error as Error).message} Flow "${flow.id}" declares it and is already registered.`
          );
        }
      }
    }
  }
  return true;
}
