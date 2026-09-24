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
 * Evaluator model strings are not overridden: the base's evaluation hook is
 * forwarded unchanged.
 */
export function forceModelResolver(base: ModelResolver, modelId: string): ModelResolver {
  const override = ((_modelId: string, blockName?: string) => base(modelId, blockName)) as ModelResolver;
  override.resolveId = (id: string) => base.resolveId(id);
  // `--model` names a generator model; evaluators keep resolving their own
  // model strings through the base resolver's evaluation hook, when it has one.
  const resolveEvaluationModel = base.resolveEvaluationModel;
  if (resolveEvaluationModel !== undefined) {
    override.resolveEvaluationModel = (id: string, blockName?: string) =>
      resolveEvaluationModel.call(base, id, blockName);
  }
  return override;
}
