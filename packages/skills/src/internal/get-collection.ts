/**
 * Shared helper to resolve a skills-style resource collection ref from the
 * unified `ctx.resources` registry on a `BlockContext`.
 *
 * Three callers in this package need the exact same lookup (slash matcher,
 * keyword matcher, classifier generator, plus the active-skills context
 * formatter); previous copies drifted slightly across files. One source
 * here keeps them aligned.
 *
 * Resolution strategy:
 *   1. Direct lookup by accessor key — `ctx.resources[key]`.
 *   2. Fall back to `ctx.resources.get(key)` — typed registry path.
 *   3. As a last resort, scan `ctx.resources.list()` for a ref whose pattern
 *      starts with `${key}/`.
 *
 * Returns `undefined` when the collection isn't registered. Callers decide
 * whether that's a hard error or a soft "no skills available" condition.
 */

import type {
  BlockContext,
  ResourceCollectionRef,
} from "@flow-state-dev/core/types";

/** Resolve the skills collection ref from the unified resource registry. */
export function getCollection(
  ctx: BlockContext,
  key: string,
): ResourceCollectionRef | undefined {
  const registry = ctx.resources as
    | (Record<string, unknown> & {
        get?: (k: string) => unknown;
        list?: () => unknown[];
      })
    | undefined;
  if (!registry) return undefined;

  // 1. Direct property lookup — accessor keys are exposed on the registry.
  const direct = registry[key];
  if (
    direct &&
    typeof direct === "object" &&
    "pattern" in (direct as object) &&
    "create" in (direct as object)
  ) {
    return direct as ResourceCollectionRef;
  }

  // 2. Typed `get(key)` if the registry exposes one.
  const get = registry.get;
  if (typeof get === "function") {
    const ref = get.call(registry, key);
    if (
      ref &&
      typeof ref === "object" &&
      "pattern" in (ref as object) &&
      "create" in (ref as object)
    ) {
      return ref as ResourceCollectionRef;
    }
  }

  // 3. Pattern-prefix scan via list().
  const list = registry.list;
  if (typeof list === "function") {
    for (const entry of list.call(registry)) {
      if (
        entry &&
        typeof entry === "object" &&
        "pattern" in (entry as object) &&
        "create" in (entry as object)
      ) {
        const ref = entry as ResourceCollectionRef;
        if (ref.pattern.startsWith(`${key}/`)) return ref;
      }
    }
  }
  return undefined;
}
