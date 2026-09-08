/**
 * The read fence for workspace-scoped hooks that stay mounted across a visit
 * (the request list, ChildSessions). Detail readers remount with the workspace
 * instead. The workspace half of the identity is supplied once rather than
 * restated per hook.
 *
 * `useReadFence` compares identity by value, which retires a read whose session
 * or client has been replaced. That is not sufficient on its own here: switching
 * instance A → B → A restores a tuple a retired callback still holds, so its
 * late result agrees and installs itself under a workspace the operator has
 * re-entered. `workspaceToken` closes that — it is bumped on every transition
 * and never returns to a previous value, so a visit that ends ends for good.
 *
 * The client is in the identity for the ordinary reason: rebuilding it on a
 * `baseUrl` or credential change makes every read in flight the previous
 * backend's.
 *
 * `extra` is whatever else the read is keyed on — usually the session id.
 */
import { useDevTool } from "../context/devtool-context";
import { useReadFence, type ReadFence } from "./use-read-fence";

export function useWorkspaceFence(
  extra: readonly unknown[],
  onRetired?: () => void,
): ReadFence {
  const { workspaceToken, sessionClient } = useDevTool();
  return useReadFence([workspaceToken, sessionClient, ...extra], onRetired);
}
