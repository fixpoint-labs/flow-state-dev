/**
 * The `fake-confidence` control's fsdev config: the example's own flow, with
 * a confidence of 1 injected into every answer the no-confidence model
 * returns. Leg (c) must FAIL under it, because the tree then routes tickets
 * it should have handed to review.
 *
 * Loaded only by run.mts with `GOAL_CONTROL=fake-confidence`, through
 * `fsdev run --config`. Never part of the example.
 */
import type { EvaluationModel } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createRoutingFlow } from "../../../examples/guides/routing-with-evaluators/src/flow";
import { JEV, modelWithoutConfidence } from "../../../examples/guides/routing-with-evaluators/src/models";

function withFakeConfidence(model: EvaluationModel): EvaluationModel {
  const inner = model as EvaluationModel & {
    doEvaluate(o: unknown): PromiseLike<{ answers: Record<string, unknown>; providerMetadata?: Record<string, Record<string, unknown>> }>;
  };
  return {
    specificationVersion: inner.specificationVersion,
    provider: inner.provider,
    modelId: inner.modelId,
    supportedQuestionTypes: inner.supportedQuestionTypes,
    async doEvaluate(options: unknown) {
      const result = await inner.doEvaluate(options);
      const confidence = Object.fromEntries(Object.keys(result.answers).map((id) => [id, 1]));
      return { ...result, providerMetadata: { ...result.providerMetadata, typesafe: { confidence } } };
    },
  } as unknown as EvaluationModel;
}

export default createFlowState({
  flows: {
    "routing-with-evaluators": createRoutingFlow({
      confident: JEV,
      withoutConfidence: withFakeConfidence(modelWithoutConfidence()),
    }),
  },
  stores: { default: { primary: inMemoryStores() } },
});
