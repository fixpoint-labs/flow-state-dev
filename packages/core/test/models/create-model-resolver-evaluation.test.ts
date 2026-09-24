/**
 * The evaluation path of `createModelResolver`: which source answers an
 * evaluator's model string, and what is refused before any provider call.
 *
 * Gateways and providers are hand-built instances that record calls, so
 * "no provider call" and "never the SDK's global default" are counters.
 * Gateway env vars are cleared so the host's own keys cannot leak in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModelResolver } from "../../src/models/createModelResolver";
import { boolean, evaluator } from "../../src/blocks/evaluator";
import { createMockContext, runForTest } from "../helpers";

function evaluationModel(provider: string, modelId: string) {
  return {
    specificationVersion: "v4",
    provider,
    modelId,
    supportedQuestionTypes: ["choice", "score", "boolean"],
    doEvaluate: vi.fn(async () => {
      throw new Error("no provider call expected in resolver tests");
    }),
  };
}

/** A gateway instance exposing `evaluationModel`, recording every id asked for. */
function evaluationGateway(name = "gateway") {
  const evaluationModelIds: string[] = [];
  const languageModel = vi.fn();
  return {
    evaluationModelIds,
    languageModel,
    instance: {
      languageModel,
      evaluationModel: (id: string) => {
        evaluationModelIds.push(id);
        return evaluationModel(name, id);
      },
    },
  };
}

describe("createModelResolver — resolveEvaluationModel", () => {
  const defaultProviderSpy = { evaluationModel: vi.fn(), languageModel: vi.fn() };

  beforeEach(() => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    // Control (D1): the AI SDK's global default provider must never be consulted.
    (globalThis as { AI_SDK_DEFAULT_PROVIDER?: unknown }).AI_SDK_DEFAULT_PROVIDER = defaultProviderSpy;
    defaultProviderSpy.evaluationModel.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as { AI_SDK_DEFAULT_PROVIDER?: unknown }).AI_SDK_DEFAULT_PROVIDER;
    expect(defaultProviderSpy.evaluationModel).not.toHaveBeenCalled();
  });

  it("resolves a provider/model string through that provider's evaluation model when it is configured (BR-6)", async () => {
    const openai = Object.assign(vi.fn(), {
      languageModel: vi.fn(),
      evaluationModel: vi.fn((id: string) => evaluationModel("openai.evaluation", id)),
    });
    const gateway = evaluationGateway();
    const resolver = createModelResolver({
      providers: { openai },
      gateways: { vercel: gateway.instance },
    });

    const model = await resolver.resolveEvaluationModel!("openai/gpt-5.4-mini");

    expect(model.modelId).toBe("gpt-5.4-mini");
    expect(openai.evaluationModel).toHaveBeenCalledWith("gpt-5.4-mini");
    expect(openai.languageModel).not.toHaveBeenCalled();
    expect(gateway.evaluationModelIds).toEqual([]);
  });

  it("loads the installed provider package when its key is set, and asks it for an evaluation model (BR-6)", async () => {
    // `@ai-sdk/openai` is a core devDependency; a key makes it available.
    const resolver = createModelResolver({ keys: { openai: "sk-test" } });
    const model = await resolver.resolveEvaluationModel!("openai/gpt-5.4-mini");
    expect(model.modelId).toBe("gpt-5.4-mini");
    expect(model.provider).toMatch(/^openai/);
    expect(model.supportedQuestionTypes.length).toBeGreaterThan(0);
  });

  it("falls through to the gateway's evaluation model when the provider has no direct path (BR-7)", async () => {
    const gateway = evaluationGateway();
    const resolver = createModelResolver({ gateways: { vercel: gateway.instance } });
    const model = await resolver.resolveEvaluationModel!("anthropic/claude-haiku-4-5");
    expect(gateway.evaluationModelIds).toEqual(["anthropic/claude-haiku-4-5"]);
    expect(model.modelId).toBe("anthropic/claude-haiku-4-5");
    expect(gateway.languageModel).not.toHaveBeenCalled();
  });

  it("routes typesafe-ai/jev and vercel/typesafe-ai/jev through the gateway, never loading Jev's library (BR-8, D2)", async () => {
    const gateway = evaluationGateway();
    const resolver = createModelResolver({ gateways: { vercel: gateway.instance } });

    await resolver.resolveEvaluationModel!("typesafe-ai/jev");
    await resolver.resolveEvaluationModel!("vercel/typesafe-ai/jev");

    expect(gateway.evaluationModelIds).toEqual(["typesafe-ai/jev", "typesafe-ai/jev"]);
  });

  it("routes typesafe-ai/jev through the gateway even when Jev's library is registered as a provider (D2)", async () => {
    // The library names Jev `jev-latest` and bills the author's own account;
    // `typesafe-ai/jev` names the gateway's Jev. Registering the library must
    // not quietly change which model and which account a string reaches.
    const typesafe = Object.assign(vi.fn(), {
      languageModel: vi.fn(),
      evaluationModel: vi.fn((id: string) => evaluationModel("typesafe-ai.evaluation", id)),
    });
    const gateway = evaluationGateway();
    const resolver = createModelResolver({
      providers: { "typesafe-ai": typesafe },
      gateways: { vercel: gateway.instance },
    });

    const model = await resolver.resolveEvaluationModel!("typesafe-ai/jev");

    expect(gateway.evaluationModelIds).toEqual(["typesafe-ai/jev"]);
    expect(model.provider).toBe("gateway");
    expect(typesafe.evaluationModel).not.toHaveBeenCalled();
    expect(typesafe).not.toHaveBeenCalled();
  });

  it("refuses typesafe-ai/jev with no gateway rather than use a registered Jev library (D2)", async () => {
    const typesafe = Object.assign(vi.fn(), {
      languageModel: vi.fn(),
      evaluationModel: vi.fn((id: string) => evaluationModel("typesafe-ai.evaluation", id)),
    });
    const resolver = createModelResolver({ providers: { "typesafe-ai": typesafe } });

    await expect(resolver.resolveEvaluationModel!("typesafe-ai/jev")).rejects.toThrow(
      /No provider available for "typesafe-ai"/
    );
    expect(typesafe.evaluationModel).not.toHaveBeenCalled();
  });

  it("does not load Jev's library for a typesafe-ai string even with its key set (BR-8, D2)", async () => {
    vi.stubEnv("TYPESAFE_AI_API_KEY", "ts-test");
    const resolver = createModelResolver({ keys: { "typesafe-ai": "ts-test" } });
    // No gateway configured: the string has nowhere to go but the library, and must not go there.
    await expect(resolver.resolveEvaluationModel!("typesafe-ai/jev")).rejects.toThrow(
      /No provider available for "typesafe-ai"/
    );
  });

  it("refuses a gateway without evaluation support before any provider call, naming it (BR-11)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const openrouter = { chat: vi.fn(), languageModel: vi.fn() };
    const resolver = createModelResolver({ gateways: { openrouter } });

    await expect(resolver.resolveEvaluationModel!("openrouter/openai/gpt-5.4-mini")).rejects.toThrow(
      /Gateway "openrouter" does not support evaluation models/
    );
    await expect(resolver.resolveEvaluationModel!("openai/gpt-5.4-mini")).rejects.toThrow(
      /Gateway "openrouter" does not support evaluation models/
    );
    expect(openrouter.chat).not.toHaveBeenCalled();
    expect(openrouter.languageModel).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("refuses an explicit provider without evaluation support, naming it (BR-11)", async () => {
    const google = Object.assign(vi.fn(), { languageModel: vi.fn() });
    const resolver = createModelResolver({ providers: { google } });
    await expect(resolver.resolveEvaluationModel!("google/gemini-3")).rejects.toThrow(
      /Provider "google" does not support evaluation models/
    );
    expect(google).not.toHaveBeenCalled();
  });

  it("refuses an intent: an evaluator names one model (BR-12)", async () => {
    const resolver = createModelResolver({
      intents: { classify: ["openai/gpt-5.4-mini"] },
      defaultModel: "openai/gpt-5.4-mini",
      gateways: { vercel: evaluationGateway().instance },
    });
    await expect(resolver.resolveEvaluationModel!("intent/classify")).rejects.toThrow(
      /intent.*one model string/
    );
  });

  it("gives the resolver's no-provider error when nothing can serve the string (BR-13)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const resolver = createModelResolver();
    await expect(resolver.resolveEvaluationModel!("openai/gpt-5.4-mini")).rejects.toThrow(
      /No provider available for "openai".*configure a gateway/s
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("answers an evaluator's model string through the resolver's gateway, never the SDK's global default (D1 control)", async () => {
    const doEvaluate = vi.fn(async () => ({
      answers: { urgent: { type: "boolean", probability: 0.3 } },
      warnings: [],
    }));
    const gateway = {
      languageModel: vi.fn(),
      evaluationModel: (id: string) => ({ ...evaluationModel("gateway", id), doEvaluate }),
    };
    const resolver = createModelResolver({ gateways: { vercel: gateway } });
    const block = evaluator({ name: "triage", model: "typesafe-ai/jev", questions: { urgent: boolean("Urgent?") } });

    const output = await runForTest(block, "x", createMockContext({ resolveModel: resolver }));

    expect(output.answers.urgent.probability).toBe(0.3);
    expect(doEvaluate).toHaveBeenCalledTimes(1);
    // afterEach asserts the global default provider was never asked.
  });

  it("leaves generator resolution unchanged (BP-035 off path)", () => {
    const gateway = evaluationGateway();
    gateway.languageModel.mockReturnValue({ specificationVersion: "v3", modelId: "x", provider: "g" });
    const resolver = createModelResolver({ gateways: { vercel: gateway.instance } });
    const model = resolver("anthropic/claude-haiku-4-5");
    expect(model.modelId).toBe("anthropic/claude-haiku-4-5");
    expect(gateway.evaluationModelIds).toEqual([]);
  });
});
