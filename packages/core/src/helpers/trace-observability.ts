/**
 * Single gate for all trace observability emissions (block_debug,
 * state_snapshot). Defaults to on in dev/test, off in production. Explicit
 * `FSDEV_TRACE_OBSERVABILITY=true|false|1|0` overrides the default.
 */

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

export function isTraceObservabilityEnabled(): boolean {
  const primary = parseBool(process.env.FSDEV_TRACE_OBSERVABILITY);
  if (primary !== undefined) return primary;

  return process.env.NODE_ENV !== "production";
}
