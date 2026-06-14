/**
 * Cross-request session continuity for the Agent SDK path.
 *
 * The SDK resumes a prior run by id (`options.resume`), so an FSD session only
 * needs to carry that id across requests — the SDK reconstructs the rest. The
 * provider is intentionally thin: `resolve(key)` returns a session record
 * holding the (possibly empty) id, and `release` is a no-op (there is no live
 * handle to tear down). It satisfies {@link BindingProvider} so a host may wrap
 * it in `createBindingCache` if desired.
 */
import type { BindingProvider } from "@flow-state-dev/core/types";

/**
 * The portable session record. `sdkSessionId` is the SDK `session_id` to resume,
 * or `null` for a fresh run. `key` echoes the resolution key for diagnostics.
 */
export interface ClaudeAgentSession {
  sdkSessionId: string | null;
}

/**
 * Create a {@link BindingProvider} for {@link ClaudeAgentSession}.
 *
 * `resolve(key)` treats a non-empty key as the SDK session id to resume and an
 * empty key as "no prior session". `release` is defined and safe to call but
 * does nothing — resume-by-id is cheap and stateless, so there is nothing to
 * dispose.
 */
export function createClaudeAgentSessionProvider(): BindingProvider<ClaudeAgentSession> {
  return {
    async resolve(key: string): Promise<ClaudeAgentSession> {
      return { sdkSessionId: key === "" ? null : key };
    },
    async release(): Promise<void> {
      // No live binding to tear down — resume-by-id is stateless.
    },
  };
}
