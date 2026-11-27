/**
 * Preloaded (`--import`) into each child `fsdev dev --watch` runs under
 * `node --watch`, before any other module loads.
 *
 * `node --watch` restarts on a change to any module its child reports loading.
 * This filter drops every reported path under `node_modules`, so installed
 * packages (and what a dev server writes there, such as Vite's bundled config)
 * never restart the child.
 *
 * A no-op outside a `node --watch` child. Imports nothing, so no module loads
 * ahead of it unfiltered.
 */

/** The report keys `node --watch` reads from its child. */
const REPORT_KEYS = ["watch:require", "watch:import"] as const;

const send = process.send?.bind(process);
if (send !== undefined && process.env.WATCH_REPORT_DEPENDENCIES !== undefined) {
  process.send = ((message: unknown, ...rest: unknown[]) => {
    const kept = filterReport(message);
    if (kept === undefined) return true;
    return (send as (...args: unknown[]) => boolean)(kept, ...rest);
  }) as typeof process.send;
}

/** `message` without paths under `node_modules`, or `undefined` when a report has none left. */
function filterReport(message: unknown): unknown {
  if (typeof message !== "object" || message === null) return message;
  const fields = message as Record<string, unknown>;
  const keys = REPORT_KEYS.filter((key) => Array.isArray(fields[key]));
  if (keys.length === 0) return message;
  const out: Record<string, unknown> = { ...fields };
  let left = 0;
  for (const key of keys) {
    const paths = (fields[key] as unknown[]).filter(
      (path) => typeof path === "string" && !/[\\/]node_modules[\\/]/.test(path),
    );
    out[key] = paths;
    left += paths.length;
  }
  return left === 0 ? undefined : out;
}

export {};
