/**
 * Storage key derivation for user- and org-scope records.
 *
 * Two factors decide whether a scope record is namespaced by `flowKind`:
 *   - The flow's `isolateUserState` / `isolateOrgState` flag (default for
 *     resources at that scope under FIX-431).
 *   - Any individual resource's `flowIsolation` field (FIX-435 — resource
 *     intent always wins).
 *
 * `resolveUserStorageKey` / `resolveOrgStorageKey` honor the *effective*
 * isolation: any user/org-scoped resource that ends up flow-isolated forces
 * the scope record to live at `${id}:${flowKind}` so its data stays private.
 * For flows whose every relevant resource is shared (or has none), the bare
 * identity id is used and storage is shared across flows for that user/org.
 */

/** Minimal flow shape carrying isolation flags plus its own `kind`. */
export interface IsolationFlow {
  kind: string;
  isolateUserState: boolean;
  isolateOrgState: boolean;
  /**
   * Flat resource declarations (FIX-435). The combined effective
   * `flowIsolation` for a given scope is "any resource at this scope that
   * resolves to isolated" — that forces the scope record into the
   * flow-namespaced slot.
   */
  resources?: Record<string, { scope?: string; flowIsolation?: boolean }>;
}

function effectiveScopeIsolation(
  flow: IsolationFlow,
  scope: "user" | "org"
): boolean {
  const flowDefault = scope === "user" ? flow.isolateUserState : flow.isolateOrgState;
  const entries = flow.resources === undefined ? [] : Object.values(flow.resources);
  for (const entry of entries) {
    if (entry.scope !== scope) continue;
    if (entry.flowIsolation === true) return true;
    if (entry.flowIsolation === false) continue;
    // unset → fall back to flow-level default
    if (flowDefault) return true;
  }
  // No resources at this scope, or all explicitly shared.
  return flowDefault;
}

/** Bare `userId` unless the flow's effective user-scope isolation is on; then `${userId}:${flowKind}`. */
export function resolveUserStorageKey(userId: string, flow: IsolationFlow): string {
  return effectiveScopeIsolation(flow, "user") ? `${userId}:${flow.kind}` : userId;
}

/** Bare `orgId` unless the flow's effective org-scope isolation is on; then `${orgId}:${flowKind}`. */
export function resolveOrgStorageKey(orgId: string, flow: IsolationFlow): string {
  return effectiveScopeIsolation(flow, "org") ? `${orgId}:${flow.kind}` : orgId;
}
