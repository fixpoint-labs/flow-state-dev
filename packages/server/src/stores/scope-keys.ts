/**
 * Storage key derivation for user- and project-scope records.
 *
 * Flows declare isolation per-scope (`isolateUserState` / `isolateProjectState`).
 * When isolation is enabled, a flow's user- or project-scope record is
 * namespaced by `flowKind` so distinct flows never share storage for that
 * scope. When isolation is disabled (default), the bare identity id is used
 * so multiple flows can share a single record per user/project.
 */
import type { FlowInstance, FlowType } from "@flow-state-dev/core/types";

/** Minimal flow shape carrying isolation flags plus its own `kind`. */
export type IsolationFlow = Pick<
  FlowInstance,
  "kind" | "isolateUserState" | "isolateProjectState"
> | Pick<FlowType, "kind" | "isolateUserState" | "isolateProjectState">;

/**
 * Derives the storage key for a user-scope record. Returns the bare `userId`
 * when the flow does not isolate user state; returns `${userId}:${flowKind}`
 * when it does.
 */
export function resolveUserStorageKey(
  userId: string,
  flow: IsolationFlow
): string {
  return flow.isolateUserState ? `${userId}:${flow.kind}` : userId;
}

/**
 * Derives the storage key for a project-scope record. Returns the bare
 * `projectId` when the flow does not isolate project state; returns
 * `${projectId}:${flowKind}` when it does.
 */
export function resolveProjectStorageKey(
  projectId: string,
  flow: IsolationFlow
): string {
  return flow.isolateProjectState ? `${projectId}:${flow.kind}` : projectId;
}
