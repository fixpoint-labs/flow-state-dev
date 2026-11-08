/**
 * A harness's readiness, as its Kitchen Sink mode's availability. A leaf
 * module: each mode's file imports it, and the gate imports each mode's file,
 * so it can't live in `harness-gate.ts`.
 */
import type { HarnessReadiness } from "@flow-state-dev/core/harness";

import type { ModeAvailability } from "./harness-gate";

/**
 * A harness's readiness (its integration package's check) as its mode's
 * availability: the check's reason and remedy, as written. An unanswered
 * check has no remedy; the picker's Re-check, or a restart, asks again.
 */
export function fromReadiness(readiness: HarnessReadiness): ModeAvailability {
  if (readiness.ready) return { available: true };
  return readiness.remedy === undefined
    ? { available: false, reason: readiness.reason }
    : { available: false, reason: readiness.reason, remedy: readiness.remedy };
}
