/**
 * Resource and scope-state notices (FIX-1506): the one helper every writer of
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
 * stream follows the write. A notice says only that the scope changed, and
 * which request changed it; the view that sent that request skips it, since
 * its own stream already carried the change. Request and block-instance
 * state publish nothing: no screen watches them.
 */
import type { ChangeKind, TopicScope } from "@flow-state-dev/core";
import { publishNotices } from "./publish-writes";
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
  /** The request that made the change, when one did. */
  requestId?: string;
};

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
      ...(change.requestId !== undefined ? { origin: { requestId: change.requestId } } : {})
    }
  ]);
}
