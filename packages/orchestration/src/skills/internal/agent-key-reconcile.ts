/**
 * Shared agent-key collision predicate for the delegation surface (FIX-928).
 *
 * Two agent-declaring skills may spill the same agent key. An IDENTICAL spec
 * under that key dedupes into one board worker; a DIVERGENT spec is a real
 * collision. That judgement — "same key, different spec" — is made in two
 * places (build-time in `library.ts`, runtime in `delegation-surface.ts`), so
 * it lives here once. The throw-vs-warn POLICY stays local to each caller: the
 * build/static paths throw, a runtime activation warns and skips.
 */
import { deepEqual } from "@flow-state-dev/core/helpers";
import type { AgentSpec } from "@flow-state-dev/core";

/**
 * True when two agent specs share a key but are NOT identical — a real
 * collision. Identical specs dedupe into one board worker; only divergent ones
 * collide.
 */
export function specsCollide(a: AgentSpec, b: AgentSpec): boolean {
  return !deepEqual(a, b);
}
