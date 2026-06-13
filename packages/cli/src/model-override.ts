/**
 * Shared `--model` override helper for the CLI commands. Both `fsdev run` and
 * `fsdev dev` force every generator onto a single model id when `--model` is
 * passed, while keeping the base resolver's gateways/providers in play.
 */
import type { ModelResolver } from "@flow-state-dev/core/types";

/**
 * Wraps a model resolver so every generator resolves to `modelId`, delegating
 * `resolveId` to the base resolver so the base's gateways/providers still apply.
 * Used to wrap both the config's resolver and the bare default resolver.
 */
export function forceModelResolver(base: ModelResolver, modelId: string): ModelResolver {
  const override = ((_modelId: string, blockName?: string) => base(modelId, blockName)) as ModelResolver;
  override.resolveId = (id: string) => base.resolveId(id);
  return override;
}
