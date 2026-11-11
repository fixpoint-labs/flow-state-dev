// FIX-1506, FIX-2551.
/**
 * The path rule: whether a change notice's resource path may belong to what a
 * screen shows. The one copy; `client.live` filters with it, and React's
 * resource hooks call it on streamed `resource_change` items through
 * `@flow-state-dev/client/internal`. Not public.
 *
 * A false yes costs one read; a false no leaves a screen stale, so every
 * doubt answers yes: roots unknown, a root with no static prefix (`""`).
 */
import { getPatternPrefix } from "@flow-state-dev/contracts/helpers";
import type { ResourceManifest } from "../types";

/** `root` without the trailing slashes a prefix constant may carry (`workforce/workers/`). */
const bare = (root: string): string => root.replace(/\/+$/, "");

/**
 * Whether a change at storage path `path` may belong under one of `roots`:
 * at a root or below it. `undefined` roots rule nothing out (not known yet),
 * and nor does an empty root (a pattern with no static prefix).
 */
export function mayHold(path: string, roots: readonly string[] | undefined): boolean {
  if (roots === undefined) return true;
  return roots.some((given) => {
    const root = bare(given);
    return root === "" || path === root || path.startsWith(`${root}/`);
  });
}

/**
 * The roots a resource held under key `ref` may change at: its key, and its
 * pattern's static prefix when the manifest names one (`roster` stores under
 * `workforce/workers/…`, so the key alone rules nothing out). `undefined`
 * while the manifest is unknown or lists no resources.
 */
export function storageRootsOf(manifest: ResourceManifest | undefined, ref: string): readonly string[] | undefined {
  if (!Array.isArray(manifest?.resources)) return undefined;
  const pattern = manifest.resources.find((entry) => entry.ref === ref)?.pattern;
  return pattern === undefined ? [ref] : [ref, getPatternPrefix(pattern)];
}
