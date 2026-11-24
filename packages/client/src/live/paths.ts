// FIX-1506, FIX-2551.
/**
 * The storage roots a screen's resource may change at, which the path rule
 * (`mayHold`, in `@flow-state-dev/contracts/types/view-hearing`) checks a
 * change notice's path against. Reached through
 * `@flow-state-dev/client/internal`. Not public.
 */
import { getPatternPrefix } from "@flow-state-dev/contracts/helpers";
import type { ResourceManifest } from "../types";

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
