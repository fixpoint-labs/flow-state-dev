/**
 * Storage key derivation for user- and org-scope records and their resources.
 *
 * Two storage concerns key off the user/org identity, and FIX-735 decouples
 * them because they answer different questions:
 *
 *   - The **scope record** (`stores.user` / `stores.org`) holds scope-level
 *     `state` (`ctx.user.state`). It is a single blob per scope, so its key
 *     is a flow-wide decision: the flow's `isolateUserState` / `isolateOrgState`
 *     flag. `resolveUserStorageKey` / `resolveOrgStorageKey` answer this.
 *
 *   - **Resources** (`stores.resourceState` / `stores.content`) key per
 *     resource. Each user/org-scoped resource keys at the bare identity id
 *     when shared (effective `flowIsolation` false) or `${id}:${flowKind}`
 *     when isolated (effective `flowIsolation` true) — honoring the
 *     resource-level override the API advertises (FIX-435) rather than a
 *     flow-wide OR. `resolveResourceIsolation` + `resolveResourceScopeId`
 *     answer this per resource; `resourceScopeIds` enumerates the distinct
 *     buckets a read path must consult.
 *
 * Before FIX-735 both concerns shared one key derived from a flow-wide OR, so
 * a `flowIsolation: false` resource was silently isolated whenever any sibling
 * was isolated. The opt-out direction is now honored.
 */

/** Minimal flow shape carrying the scope-isolation flags plus its own `kind`. */
export interface IsolationFlow {
  kind: string;
  isolateUserState: boolean;
  isolateOrgState: boolean;
  /**
   * Flat resource declarations (FIX-435). Consulted by `resourceScopeIds`
   * to enumerate the per-resource isolation buckets in play for a scope.
   */
  resources?: Record<string, { scope?: string; flowIsolation?: boolean }>;
}

/**
 * Bare `userId` unless the flow isolates the user scope; then
 * `${userId}:${flowKind}`. Governs the scope *record* (`ctx.user.state`)
 * only — resources route per-resource via `resolveResourceScopeId`.
 */
export function resolveUserStorageKey(
  userId: string,
  flow: Pick<IsolationFlow, "kind" | "isolateUserState">
): string {
  return flow.isolateUserState ? `${userId}:${flow.kind}` : userId;
}

/**
 * Bare `orgId` unless the flow isolates the org scope; then
 * `${orgId}:${flowKind}`. Governs the scope *record* (`ctx.org.state`)
 * only — resources route per-resource via `resolveResourceScopeId`.
 */
export function resolveOrgStorageKey(
  orgId: string,
  flow: Pick<IsolationFlow, "kind" | "isolateOrgState">
): string {
  return flow.isolateOrgState ? `${orgId}:${flow.kind}` : orgId;
}

/**
 * Effective isolation for a single resource: its own `flowIsolation` when
 * set, otherwise the scope's flow-level default. Resource-level declarations
 * always win (FIX-435), in both the opt-in and opt-out directions.
 */
export function resolveResourceIsolation(
  resourceFlowIsolation: boolean | undefined,
  flow: Pick<IsolationFlow, "isolateUserState" | "isolateOrgState">,
  scope: "user" | "org"
): boolean {
  if (resourceFlowIsolation !== undefined) return resourceFlowIsolation;
  return scope === "user" ? flow.isolateUserState : flow.isolateOrgState;
}

/**
 * The `scopeId` a resource's per-resource storage (`resourceState` / `content`)
 * lives at: bare `identityId` when shared, `${identityId}:${flowKind}` when
 * isolated.
 */
export function resolveResourceScopeId(
  identityId: string,
  flowKind: string,
  isolated: boolean
): string {
  return isolated ? `${identityId}:${flowKind}` : identityId;
}

/**
 * The distinct storage `scopeId`s a flow's user/org-scoped resources occupy
 * for a given identity — at most two (the bare bucket and the
 * flow-namespaced bucket). Read paths consult every returned id and merge,
 * since a flow may declare both shared and isolated resources at one scope.
 *
 * When the flow declares no resources at the scope, falls back to the
 * scope-record bucket (the flow-flag key) so callers still resolve a key.
 */
export function resourceScopeIds(
  identityId: string,
  flow: IsolationFlow,
  scope: "user" | "org"
): string[] {
  const ids = new Set<string>();
  const entries = flow.resources === undefined ? [] : Object.values(flow.resources);
  for (const entry of entries) {
    if (entry.scope !== scope) continue;
    const isolated = resolveResourceIsolation(entry.flowIsolation, flow, scope);
    ids.add(resolveResourceScopeId(identityId, flow.kind, isolated));
  }
  if (ids.size === 0) {
    const flowDefault = scope === "user" ? flow.isolateUserState : flow.isolateOrgState;
    ids.add(resolveResourceScopeId(identityId, flow.kind, flowDefault));
  }
  return [...ids];
}
