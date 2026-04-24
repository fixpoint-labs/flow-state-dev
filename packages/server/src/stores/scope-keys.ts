/**
 * Storage key derivation for user- and project-scope records.
 *
 * When a flow sets `isolateUserState` or `isolateProjectState`, its scope
 * record is namespaced by `flowKind` so distinct flows never share storage
 * for that scope. Default: bare identity id — multiple flows share one
 * record per user/project.
 */

/** Minimal flow shape carrying isolation flags plus its own `kind`. */
export interface IsolationFlow {
  kind: string;
  isolateUserState: boolean;
  isolateProjectState: boolean;
}

/** Bare `userId` unless the flow isolates user state; then `${userId}:${flowKind}`. */
export function resolveUserStorageKey(userId: string, flow: IsolationFlow): string {
  return flow.isolateUserState ? `${userId}:${flow.kind}` : userId;
}

/** Bare `projectId` unless the flow isolates project state; then `${projectId}:${flowKind}`. */
export function resolveProjectStorageKey(projectId: string, flow: IsolationFlow): string {
  return flow.isolateProjectState ? `${projectId}:${flow.kind}` : projectId;
}
