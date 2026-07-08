/**
 * Runtime-config helper for the orchestrator's `runAction` / `continueRequest`
 * calls.
 *
 * The orchestrator flow is a conductor — it dispatches agents and gates on
 * suspensions, and declares NO generators. But `runAction` always builds a
 * model resolver for the execution context, and the default resolver validates
 * any `FSDEV_INTENT_*` environment overrides against the flow's declared intents
 * (here, none) and throws. We therefore pass the lab's shared no-op resolver
 * (see ../no-model-resolver.ts), which also keeps the orchestrator immune to
 * whatever model env a host happens to set.
 */
import type { DurabilityProvider, RuntimeConfig } from "@flow-state-dev/server";
import { noModelResolver } from "../no-model-resolver";

export { noModelResolver };

/** Runtime config for every orchestrator run: durable provider + the no-op resolver. */
export function orchestratorRuntimeConfig(provider: DurabilityProvider): RuntimeConfig {
  return { durabilityProvider: provider, modelResolver: noModelResolver };
}
