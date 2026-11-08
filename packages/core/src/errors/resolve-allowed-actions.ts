/**
 * The resolution actions a suspension permits, defaulted by its reason.
 *
 * Its own module, apart from `suspension-error.ts`, because that file is a
 * public subpath (`core/errors/suspension-error`) and this helper is a runtime
 * seam: the engine's suspension-record builder reads it through
 * `@flow-state-dev/core/internal`.
 */
import type { ResumeAction, SuspensionReason } from "../types/suspension";

/**
 * Resolve the permitted resolution actions for a suspension, applying the
 * reason-based default when the author did not pass `allow` explicitly. Shared
 * by the suspension-record builder and any caller that needs the concrete set.
 */
export function resolveAllowedActions(
  reason: SuspensionReason,
  allow: ResumeAction[] | undefined
): ResumeAction[] {
  if (allow !== undefined) return allow;
  return reason === "user_input" || reason === "human_input" ? ["submit"] : ["approve", "reject"]; // retired-name-refusal: a stop core 0.2.0 stored
}
