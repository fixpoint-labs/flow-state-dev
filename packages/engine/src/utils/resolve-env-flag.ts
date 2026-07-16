/**
 * Resolve a boolean dev/ops flag that a caller may set explicitly or leave to
 * an env fallback. An explicit `true`/`false` always wins; `undefined` falls
 * back to `process.env[envVar] === "1"` (only the literal `"1"` counts as on).
 *
 * This is the shared rule behind the framework's dev-toggle pairs —
 * `debugEndpointsEnabled` / `FSDEV_DEBUG_ENDPOINTS` and `devAuth` /
 * `FSDEV_DEV_AUTH` — so a new `FSDEV_*` flag reuses one tested primitive
 * instead of re-deriving the precedence inline.
 */
export function resolveEnvFlag(
  explicit: boolean | undefined,
  envVar: string
): boolean {
  return explicit === undefined ? process.env[envVar] === "1" : explicit;
}
