/**
 * Resolve a `ResourceCollectionRef` from the unified `ctx.resources` registry
 * by its accessor key.
 *
 * Hoisted to the tasks layer (from the former `skills/internal/get-collection`)
 * so both the skills runtime and the durable task-board capability share one
 * lookup without the task board importing from `skills`.
 *
 * Resolution strategy:
 *   1. Direct lookup by accessor key — `ctx.resources[key]`.
 *   2. Fall back to `ctx.resources.get(key)` — typed registry path.
 *   3. As a last resort, scan `ctx.resources.list()` for a ref whose pattern
 *      starts with `${key}/`.
 *
 * Returns `undefined` when the collection isn't registered. Callers decide
 * whether that's a hard error or a soft "not available" condition.
 */

import type {
  BlockContext,
  ResourceCollectionRef,
} from "@flow-state-dev/core/types";

function looksLikeCollectionRef(value: unknown): value is ResourceCollectionRef {
  return (
    typeof value === "object" &&
    value !== null &&
    "pattern" in (value as object) &&
    "create" in (value as object)
  );
}

/** Resolve a resource collection ref from the unified resource registry. */
export function resolveResourceCollection(
  ctx: BlockContext,
  key: string
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
  if (looksLikeCollectionRef(direct)) return direct;

  // 2. Typed `get(key)` if the registry exposes one.
  const get = registry.get;
  if (typeof get === "function") {
    const ref = get.call(registry, key);
    if (looksLikeCollectionRef(ref)) return ref;
  }

  // 3. Pattern-prefix scan via list().
  const list = registry.list;
  if (typeof list === "function") {
    for (const entry of list.call(registry)) {
      if (looksLikeCollectionRef(entry) && entry.pattern.startsWith(`${key}/`)) {
        return entry;
      }
    }
  }
  return undefined;
}
