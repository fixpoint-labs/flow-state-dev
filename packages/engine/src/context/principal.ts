// FIX-2942; BP-030; BP-031.
/**
 * The one principal a run carries, and the one owner comparison every door
 * applies to it.
 *
 * A principal is set once, at the door: `host.resolvePrincipal` names the user
 * and organization from the caller's credentials, says the caller is a
 * person, and records which resolver answered (`resolvedBy`). A door that
 * fires for a machine (the scheduled route's gateway fallback and the system
 * principal, the webhook route's delivery principal) says so with
 * `kind: "machine"`. Dispatch, sub-flows, owner runs, wakes, schedules and
 * webhooks carry it unchanged; nothing below the door decides who a run is.
 *
 * `kind` is the only machine marker. A run whose principal, or whose session,
 * is a machine's reaches no session but its own.
 */
import type { ResolvedPrincipal } from "@flow-state-dev/core/types";
import { resolveSessionStorageKey, tenantMatches } from "../stores/scope-keys";
import type { StoreRegistry } from "../stores/types";
import { CLI_SOURCE, INTERNAL_SOURCE, TASK_SOURCE } from "../execution/transport-sources";

/** Who a principal names: a person, or a machine (a schedule's gateway, the system user, a delivery). */
export type PrincipalKind = "person" | "machine";

/**
 * The principal a run runs as. Built on core's {@link ResolvedPrincipal}.
 *
 * `resolvedBy` names the resolver that produced it, with the host settings
 * applied to its answer (`requireUser`, `defaultUserId`): a value, so it rides
 * a runner's envelope. Absent on a principal no resolver produced (a
 * schedule's named person, a record stored before the field), and an absent
 * value matches nothing.
 */
export interface Principal extends ResolvedPrincipal {
  readonly tenantId?: string;
  readonly kind: PrincipalKind;
  readonly resolvedBy?: string;
}

/** The system principal's user (`ScheduleConfig.principal`): a machine wherever it appears. */
const SYSTEM_USER_ID = "system";

/**
 * The kind a principal assembled without its door's answer reads as: a
 * machine's (fail closed). `== null` covers a record or envelope written
 * before the field existed.
 */
export function principalKindOf(kind: PrincipalKind | null | undefined): PrincipalKind {
  return kind === "person" ? "person" : "machine";
}

/** The identity facts an owned record carries: a session, a request record, an in-flight entry. */
export type OwnedIdentity = {
  readonly userId: string;
  readonly orgId?: string | null;
  readonly tenantId?: string | null;
};

/**
 * Whether `record` is `principal`'s: the same user, the same organization and
 * the same tenant, each exact (absent equals only absent). Every principal a
 * door sets names an organization, so a record with none is no one's here; a
 * door that tolerates one (the request-id claim) normalises it before asking.
 * The one owner comparison: the session and request routes, the view host
 * rule, the own-resolver verdict and a block's named reach all call it.
 */
export function principalOwns(
  record: OwnedIdentity,
  principal: { readonly userId: string; readonly orgId?: string; readonly tenantId?: string }
): boolean {
  if (record.userId !== principal.userId) return false;
  if ((record.orgId ?? undefined) !== principal.orgId) return false;
  return tenantMatches(record.tenantId ?? undefined, principal.tenantId);
}

/**
 * Whether a principal's `resolvedBy` names the resolver identity `target`.
 * Absent on either side never matches.
 */
export function resolvedByMatches(resolvedBy: string | undefined, target: string | undefined): boolean {
  return resolvedBy !== undefined && target !== undefined && resolvedBy === target;
}

// FIX-2942; BP-030.
/**
 * `record` with the organization it belongs to: its own, or, for a record
 * written before organizations were stamped, its session's. The request-id
 * claim's tolerance for those records, applied at read so the one exact owner
 * comparison (`principalOwns`) decides: an owner retrying such an id reuses
 * it, and nobody else gains it, since user and tenant still compare exactly.
 * A record whose session is gone, or has no organization either, stays
 * unattributed and is no one's.
 */
export async function withRequestOrg<T extends OwnedIdentity & { sessionId?: string | null }>(
  stores: Pick<StoreRegistry, "session">,
  record: T
): Promise<T> {
  if (record.orgId != null || record.sessionId == null) return record;
  const session = await stores.session.get(resolveSessionStorageKey(record.sessionId, record.tenantId ?? undefined));
  if (session?.orgId == null || session.userId !== record.userId) return record;
  return { ...record, orgId: session.orgId };
}

// FIX-2942.
/**
 * The kind a scheduled fire runs as, decided at the scheduled route where its
 * effective principal is chosen: a machine's when that is the gateway it
 * fires as (the fallback, or a schedule naming the gateway's own user and
 * org) or the system user; a person's when the schedule names a real person.
 */
export function scheduledFireKind(effective: ResolvedPrincipal, gateway: ResolvedPrincipal): PrincipalKind {
  if (effective.userId === SYSTEM_USER_ID) return "machine";
  if (effective.userId === gateway.userId && effective.orgId === gateway.orgId) return "machine";
  return "person";
}

/** Doors a person's credentials arrive on: each resolves a principal through `host.resolvePrincipal`. */
const PERSON_SOURCES: ReadonlySet<string> = new Set(["http", "mcp", CLI_SOURCE]);
/** Dispatches, whose session takes its dispatching parent's kind. */
const DISPATCH_SOURCES: ReadonlySet<string> = new Set([INTERNAL_SOURCE, TASK_SOURCE]);

// BP-030.
/**
 * The kind a session written before `SessionRecord.principalKind` existed
 * reads as, from its first request record (`context/session-kind.ts`):
 *
 * - `http`, `mcp`, `cli`, and a record from before `source` (stores read it
 *   as `http`): a person's.
 * - `internal` or `task`: its parent's (`"parent"`), by the parent walk.
 * - `scheduled`, `webhook`, `notification`, a request whose user is the
 *   system user, any other value, and no readable request: a machine's.
 */
export function firstRequestKind(
  request: { readonly source?: string | null; readonly userId: string } | undefined
): PrincipalKind | "parent" {
  if (request === undefined || request.userId === SYSTEM_USER_ID) return "machine";
  const origin = request.source ?? "http";
  if (PERSON_SOURCES.has(origin)) return "person";
  if (DISPATCH_SOURCES.has(origin)) return "parent";
  return "machine";
}
