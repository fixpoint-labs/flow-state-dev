/**
 * Which gateway routed an evaluation model, carried from the model resolver
 * to the evaluation seam.
 *
 * A generator's model is wrapped by the resolver, so the wrapper carries the
 * gateway into its `ModelIdentity`. An evaluation model is the AI SDK's own
 * object, handed to the SDK unwrapped, so the resolver records the gateway
 * here instead, keyed by the model instance. `runEvaluation` reads it into
 * the identity it reports, so an evaluator's trace names the gateway the
 * same way a generator's does. A model the author built directly, or one a
 * custom resolver returns, has no entry and reports no gateway.
 */

const gatewayByModel = new WeakMap<object, string>();

/**
 * Record that `model` is served through `gateway` (e.g. `"vercel"`).
 * Returns the model unchanged.
 */
export function markEvaluationModelGateway<TModel extends object>(model: TModel, gateway: string): TModel {
  gatewayByModel.set(model, gateway);
  return model;
}

/** The gateway that serves `model`, when the model resolver recorded one. */
export function evaluationModelGateway(model: object): string | undefined {
  return gatewayByModel.get(model);
}
