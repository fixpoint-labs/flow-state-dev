/**
 * Shared helper to resolve a skills-style resource collection ref from the
 * appropriate scope registry on a `BlockContext`.
 *
 * Three callers in this package need the exact same lookup (slash matcher,
 * keyword matcher, classifier generator, plus the active-skills context
 * formatter); previous copies drifted slightly across files. One source
 * here keeps them aligned.
 *
 * Resolution strategy:
 *   1. Try the registry's typed `get(key)` — fast path on registries that
 *      expose it.
 *   2. Fall back to scanning `list()` for a ref whose pattern starts with
 *      `${key}/` — works on registries that don't expose a typed get.
 *
 * Returns `undefined` when the collection isn't registered. Callers decide
 * whether that's a hard error or a soft "no skills available" condition.
 */

import type {
  BlockContext,
  ResourceCollectionRef,
  ScopeType,
} from "@flow-state-dev/core/types";

/** Resolve the skills collection ref from the appropriate scope registry. */
export function getCollection(
  ctx: BlockContext,
  scope: ScopeType,
  key: string,
): ResourceCollectionRef | undefined {
  const registry =
    scope === "session"
      ? ctx.session?.resources
      : scope === "user"
        ? ctx.user?.resources
        : ctx.project?.resources;
  if (!registry) return undefined;

  const get = (registry as { get?: (k: string) => unknown }).get;
  if (typeof get === "function") {
    const ref = get.call(registry, key);
    if (ref && typeof ref === "object" && "pattern" in ref) {
      return ref as ResourceCollectionRef;
    }
  }

  const list = (registry as { list?: () => unknown[] }).list;
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
