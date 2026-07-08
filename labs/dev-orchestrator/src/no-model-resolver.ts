/**
 * A model resolver for flows that declare no generators.
 *
 * `runAction` always builds a model resolver for the execution context, and
 * the default resolver validates any `FSDEV_INTENT_*` environment overrides
 * against the flow's declared intents. A flow with no generators declares
 * none, so the default resolver throws on any `FSDEV_INTENT_*` a host
 * happens to set. This trivial resolver is never actually invoked (no
 * generator ever resolves a model) and keeps such flows immune to whatever
 * model env a host sets. Shared by every generator-less flow in this lab.
 */
import type { ModelResolver } from "@flow-state-dev/core/types";

/** A resolver that throws if ever asked to resolve a model (it never is). */
export const noModelResolver = Object.assign(
  (modelId: string) => {
    throw new Error(`This flow declares no generators; cannot resolve model "${modelId}".`);
  },
  { resolveId: (modelId: string) => modelId },
) as unknown as ModelResolver;
