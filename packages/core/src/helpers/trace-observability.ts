/**
 * Single gate for all trace observability emissions (block_debug,
 * state_snapshot). Defaults to on in dev/test, off in production. Explicit
 * `FSDEV_TRACE_OBSERVABILITY=true|false|1|0` overrides the default.
 *
 * The legacy `FSDEV_DEBUG_ITEMS` env var is honored as a fallback for one
 * release cycle to ease migration; a deprecation warning is logged the first
 * time it is consulted.
 */

let warnedLegacy = false;

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

export function isTraceObservabilityEnabled(): boolean {
  const primary = parseBool(process.env.FSDEV_TRACE_OBSERVABILITY);
  if (primary !== undefined) return primary;

  const legacy = parseBool(process.env.FSDEV_DEBUG_ITEMS);
  if (legacy !== undefined) {
    if (!warnedLegacy) {
      warnedLegacy = true;
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(
          "[flow-state] FSDEV_DEBUG_ITEMS is deprecated; use FSDEV_TRACE_OBSERVABILITY instead."
        );
      }
    }
    return legacy;
  }

  return process.env.NODE_ENV !== "production";
}
