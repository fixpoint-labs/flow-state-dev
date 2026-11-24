/**
 * `--model` forces every generator onto one model. Evaluators keep resolving
 * their own model strings through the base resolver's evaluation hook; a base
 * without the hook stays without it, so evaluator strings are refused rather
 * than silently resolved elsewhere.
 */
import { describe, expect, it, vi } from "vitest";
import type { EvaluationModel, GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { forceModelResolver } from "../src/model-override";

function baseResolver(withHook: boolean) {
  const generate = vi.fn((id: string): GeneratorModel => ({ modelId: id, generate: async () => ({}) }));
  const resolver = generate as unknown as ModelResolver;
  resolver.resolveId = (id) => id;
  const evaluationModel = { modelId: "jev" } as unknown as EvaluationModel;
  const hook = vi.fn(() => evaluationModel);
  if (withHook) resolver.resolveEvaluationModel = hook;
  return { resolver, generate, hook, evaluationModel };
}

describe("forceModelResolver", () => {
  it("forces generator models but forwards evaluator strings to the base's evaluation hook unchanged", async () => {
    const { resolver, generate, hook, evaluationModel } = baseResolver(true);
    const forced = forceModelResolver(resolver, "openai/gpt-5.4-mini");

    forced("anthropic/claude-haiku-4-5", "writer");
    expect(generate).toHaveBeenCalledWith("openai/gpt-5.4-mini", "writer");

    expect(await forced.resolveEvaluationModel!("typesafe-ai/jev", "triage")).toBe(evaluationModel);
    expect(hook).toHaveBeenCalledWith("typesafe-ai/jev", "triage");
  });

  it("adds no evaluation hook when the base has none", () => {
    const { resolver } = baseResolver(false);
    expect(forceModelResolver(resolver, "openai/gpt-5.4-mini").resolveEvaluationModel).toBeUndefined();
  });
});
