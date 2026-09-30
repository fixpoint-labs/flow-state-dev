/**
 * The DevTool connection config a served page is handed: which user the page
 * reads as, and the bearer it presents, as an app's `fsdev.config.*` declares
 * them in its `devtool` block.
 */
import type { DevToolConnectionConfig, FlowState } from "@flow-state-dev/engine";

/**
 * The `devtool` block a `FlowState` declares, or `undefined` when it declares
 * neither a user nor a bearer.
 *
 * An empty or blank-only block is normalized to `undefined`, so a host that
 * passes the result to `serve()` leaves the static page byte-identical to
 * production. `serve()` injects what this returns on a loopback host only.
 *
 * @param flowState The app's `FlowState`. Reads its sync `meta` getter only, so
 *   no store is initialized.
 */
export function declaredDevtoolConfig(flowState: FlowState): DevToolConnectionConfig | undefined {
  const declared = flowState.meta.devtool;
  const hasField =
    (declared?.userId?.trim().length ?? 0) > 0 || (declared?.bearerToken?.trim().length ?? 0) > 0;
  return hasField ? declared : undefined;
}
