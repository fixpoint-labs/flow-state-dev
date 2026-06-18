/**
 * Runtime-config helper for the orchestrator's `runAction` / `continueRequest`
 * calls.
 *
 * The orchestrator flow is a conductor — it dispatches agents and gates on
 * suspensions, and declares NO generators. But `runAction` always builds a
 * model resolver for the execution context, and the default resolver validates
 * any `FSDEV_INTENT_*` environment overrides against the flow's declared intents
 * (here, none) and throws. We therefore pass a trivial resolver that is never
 * actually invoked (no generator ever resolves a model), which also keeps the
 * orchestrator immune to whatever model env a host happens to set.
 */
import type { ModelResolver } from "@flow-state-dev/core/types";
import type { DurabilityProvider, RuntimeConfig } from "@flow-state-dev/server";

/** A resolver that throws if ever asked to resolve a model (it never is). */
export const noModelResolver = Object.assign(
  (modelId: string) => {
    throw new Error(
      `dev-orchestrator flows declare no generators; cannot resolve model "${modelId}".`,
    );
  },
  { resolveId: (modelId: string) => modelId },
) as unknown as ModelResolver;

/** Runtime config for every orchestrator run: durable provider + the no-op resolver. */
export function orchestratorRuntimeConfig(provider: DurabilityProvider): RuntimeConfig {
  return { durabilityProvider: provider, modelResolver: noModelResolver };
}
