/**
 * Tracing verbosity for observability (non-durable) state snapshots and
 * related trace items (FIX-406 6H).
 *
 *   - `verbose`: every snapshot, including per-step (DevTool observation).
 *   - `normal`:  block-boundary snapshots only (sequencer entry + exit), not
 *                per-step.
 *   - `minimal`: no observability snapshots.
 *
 * This gates only NON-durable snapshots. Durable checkpoints always emit
 * regardless of level — they are the crash-resume record, not observability.
 */
import { isTraceObservabilityEnabled } from "./trace-observability";

export type TracingLevel = "verbose" | "normal" | "minimal";

function parseLevel(value: string | undefined): TracingLevel | undefined {
  if (value === "verbose" || value === "normal" || value === "minimal") {
    return value;
  }
  return undefined;
}

/**
 * Resolves the effective tracing level. Precedence: an explicit value (e.g. a
 * `createFlowApiRouter({ tracingLevel })` setting threaded through context),
 * then the `FSDEV_TRACING_LEVEL` env var, then a default derived from the
 * legacy trace-observability gate so behavior is unchanged for callers that
 * never set a level (`verbose` in dev/test, `minimal` in production).
 */
export function resolveTracingLevel(explicit?: TracingLevel): TracingLevel {
  if (explicit !== undefined) return explicit;

  const fromEnv = parseLevel(process.env.FSDEV_TRACING_LEVEL);
  if (fromEnv !== undefined) return fromEnv;

  return isTraceObservabilityEnabled() ? "verbose" : "minimal";
}
