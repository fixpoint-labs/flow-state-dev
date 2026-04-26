/**
 * Storage key derivation for user- and org-scope records.
 *
 * When a flow sets `isolateUserState` or `isolateOrgState`, its scope
 * record is namespaced by `flowKind` so distinct flows never share storage
 * for that scope. Default: bare identity id — multiple flows share one
 * record per user/org.
 */

/** Minimal flow shape carrying isolation flags plus its own `kind`. */
export interface IsolationFlow {
  kind: string;
  isolateUserState: boolean;
  isolateOrgState: boolean;
}

/** Bare `userId` unless the flow isolates user state; then `${userId}:${flowKind}`. */
export function resolveUserStorageKey(userId: string, flow: IsolationFlow): string {
  return flow.isolateUserState ? `${userId}:${flow.kind}` : userId;
}

/** Bare `orgId` unless the flow isolates org state; then `${orgId}:${flowKind}`. */
export function resolveOrgStorageKey(orgId: string, flow: IsolationFlow): string {
  return flow.isolateOrgState ? `${orgId}:${flow.kind}` : orgId;
}
