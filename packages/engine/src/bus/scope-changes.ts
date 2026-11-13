// FIX-1506.
/**
 * Resource and scope-state notices: the one helper every writer of
 * a scope's state or of a client-readable resource publishes through.
 *
 * | Writer | Where | Origin |
 * |---|---|---|
 * | a session, user or org state write in a run | `emitWrap`'s `onCommitted` (`createExecutionContext.ts`) | the run's request |
 * | a resource write, create, delete or content write in a run | `makeResourceChangeHandler` (same file) | the run's request |
 * | a collection create, content update or delete from a browser | the resource routes (`resource-routes.ts`) | none |
 *
 * Each runs after its write lands, beside the `state_change` or
 * `resource_change` item the writer's own stream gets, and whether or not a
 * stream follows the write. A notice says only that the scope changed, which
 * request changed it, and, for a collection entry it may name, the entry's
 * storage key (`entryNotice`); the view that sent that request skips it, since
 * its own stream already carried the change. Request and block-instance
 * state publish nothing: no screen watches them.
 */
import type { ChangeKind, TopicScope } from "@flow-state-dev/core/internal";
import { publishNotices } from "./publish-writes";
import { ownerKeyAdmits } from "../resources/owner-private";
import type { ChangeBus } from "./types";

/** Which scope changed, under which tenant, and which request changed it. */
export type ScopeChange = {
  scope: TopicScope;
  /** The bare session id, the user id or the org id. */
  id: string;
  tenantId: string | undefined;
  kind: Extract<ChangeKind, "state" | "resource">;
  /** The resource's storage path, for a `resource` change. */
  resource?: string;
  // FIX-2625.
  /** A collection entry's storage key, beside the path that names it (`entryNotice`). Never without `resource`. */
  ids?: string[];
  /** The request that made the change, when one did. */
  requestId?: string;
};

/**
 * The resource path a notice may name for the row at `storageKey` of
 * `collection`, or `undefined` to publish on the bare scope topic.
 *
 * Everyone who may hear the scope's topic hears the path. So the path goes
 * out only when the reads' own predicate ({@link ownerKeyAdmits}) admits the
 * row to a reader with no identity, meaning any reader the scope serves. An
 * owner-private row (`drafts/~alice/…`) is admitted only to its owner, so
 * its notice names no path. Every view of the scope wakes and reads again
 * through its own checks: the owner sees the change, and nobody else learns
 * the key. A single resource (`collection` undefined) is the same for every
 * caller, so its key is named. A user-scope entry names no path either: the
 * user topic spans the user's orgs, and their user cells don't.
 */
export function noticePathFor(
  collection: object | undefined,
  storageKey: string,
  scope?: TopicScope
): string | undefined {
  if (collection === undefined) return storageKey;
  // A user's topic is theirs in every org, while their user cell is per org:
  // an entry's key written in one org would reach their pages in the others.
  // The bare notice still wakes every view of the scope (FIX-2624).
  if (scope === "user") return undefined;
  return ownerKeyAdmits(collection, storageKey, undefined) ? storageKey : undefined;
}

// FIX-2625.
/**
 * A collection entry's notice: narrowed to its path and naming its storage key
 * when the path may be named (`noticePathFor`), else bare, naming nothing. A
 * notice that names no path names no id (epic ER-10).
 */
export function entryNotice(collection: object, storageKey: string, scope?: TopicScope): { resource?: string; ids?: string[] } {
  const resource = noticePathFor(collection, storageKey, scope);
  return resource === undefined ? {} : { resource, ids: [resource] };
}

// FIX-2623 D1.
/**
 * A session resource write, as every writer publishes it: a run, the
 * resource routes, any other. The one place the lineage rule for publication
 * lives, matching the read side's (`createViewDependencies`).
 *
 * - `notice`: the session topic notice, narrowed to `resource` when the row
 *   may be named (`noticePathFor`), or `undefined` for none (a run whose
 *   resource no view of the session reads, on a host with no view).
 * - `lineageShared`: whether the row's storage key is lineage-shared, by the
 *   ownership rule write routing uses (`sessionKeySharesLineage` or the
 *   session buckets). When it is and the host has a view, the write also
 *   publishes on the session owner's user topic, bare: every lineage member
 *   belongs to that one user (enforced where a lineage is inherited, by the
 *   dispatch seed and `evaluateAdoption`).
 * - `ownerUserId`: the owner of the session record the writer holds, never a
 *   caller-supplied or cached value.
 */
export function publishSessionResourceChange(
  bus: ChangeBus | undefined,
  change: {
    sessionId: string;
    ownerUserId: string;
    tenantId: string | undefined;
    notice: { resource?: string; ids?: string[] } | undefined;
    lineageShared: boolean;
    hostHasViews: boolean;
    requestId?: string;
  }
): void {
  const origin = change.requestId !== undefined ? { requestId: change.requestId } : {};
  if (change.lineageShared && change.hostHasViews) {
    publishScopeChange(bus, { scope: "user", id: change.ownerUserId, tenantId: change.tenantId, kind: "resource", ...origin });
  }
  if (change.notice !== undefined) {
    publishScopeChange(bus, {
      scope: "session",
      id: change.sessionId,
      tenantId: change.tenantId,
      kind: "resource",
      ...(change.notice.resource !== undefined ? { resource: change.notice.resource } : {}),
      ...(change.notice.resource !== undefined && change.notice.ids !== undefined ? { ids: change.notice.ids } : {}),
      ...origin
    });
  }
}

/**
 * Publish `change` on its scope's topic. A missing bus publishes nothing;
 * a failed publish never fails the write (epic ER-6).
 */
export function publishScopeChange(bus: ChangeBus | undefined, change: ScopeChange): void {
  if (bus === undefined) return;
  publishNotices(bus, [
    {
      topic: {
        scope: change.scope,
        id: change.id,
        tenantId: change.tenantId ?? "",
        ...(change.resource !== undefined ? { resource: change.resource } : {})
      },
      kind: change.kind,
      ...(change.requestId !== undefined ? { origin: { requestId: change.requestId } } : {}),
      // A notice with no path names no id (epic ER-10).
      ...(change.resource !== undefined && change.ids !== undefined ? { ids: change.ids } : {})
    }
  ]);
}
