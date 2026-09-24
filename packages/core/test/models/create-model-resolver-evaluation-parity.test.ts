/**
 * The generator path and the evaluation path of `createModelResolver` pick
 * the same source for the same model string: an explicit provider instance,
 * an installed-and-keyed provider package, or a gateway (spec D1, "same
 * precedence as a generator string").
 *
 * The two paths are separate code today, so nothing but this test keeps them
 * in lockstep. Each case builds a fresh resolver, resolves the string both
 * ways, and reads which source was asked from recording fakes. The one
 * documented exception, a `typesafe-ai/...` string always meaning the gateway
 * for an evaluator (D2), is asserted on its own below.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModelResolver, type CreateModelResolverOptions } from "../../src/models/createModelResolver";

type Source = "explicit" | "package" | "gateway" | "none";

function fakeLanguageModel(provider: string, modelId: string) {
  return { specificationVersion: "v3", provider, modelId };
}

function fakeEvaluationModel(provider: string, modelId: string) {
  return {
    specificationVersion: "v4",
    provider,
    modelId,
    supportedQuestionTypes: ["choice", "score", "boolean"],
    doEvaluate: vi.fn(),
  };
}

/** A provider instance that records whether either path asked it for a model. */
function explicitProvider(name: string) {
  const asked = { language: 0, evaluation: 0 };
  const provider = Object.assign(
    vi.fn((id: string) => {
      asked.language += 1;
      return fakeLanguageModel(name, id);
    }),
    {
      languageModel: vi.fn((id: string) => {
        asked.language += 1;
        return fakeLanguageModel(name, id);
      }),
      evaluationModel: vi.fn((id: string) => {
        asked.evaluation += 1;
        return fakeEvaluationModel(name, id);
      }),
    }
  );
  return { provider, asked };
}

/** A gateway instance that records whether either path asked it for a model. */
function gatewayInstance() {
  const asked = { language: 0, evaluation: 0 };
  return {
    asked,
    instance: {
      languageModel: (id: string) => {
        asked.language += 1;
        return fakeLanguageModel("gateway", id);
      },
      evaluationModel: (id: string) => {
        asked.evaluation += 1;
        return fakeEvaluationModel("gateway", id);
      },
    },
  };
}

type Setup = {
  name: string;
  build: () => {
    options: CreateModelResolverOptions;
    explicit?: { asked: { language: number; evaluation: number } };
    gateway?: { asked: { language: number; evaluation: number } };
  };
};

const setups: Setup[] = [
  {
    name: "explicit openai provider + gateway",
    build: () => {
      const explicit = explicitProvider("openai");
      const gateway = gatewayInstance();
      return {
        options: { providers: { openai: explicit.provider }, gateways: { vercel: gateway.instance } },
        explicit,
        gateway,
      };
    },
  },
  {
    name: "openai key (installed package) + gateway",
    build: () => {
      const gateway = gatewayInstance();
      return { options: { keys: { openai: "sk-test" }, gateways: { vercel: gateway.instance } }, gateway };
    },
  },
  {
    name: "gateway only",
    build: () => {
      const gateway = gatewayInstance();
      return { options: { gateways: { vercel: gateway.instance } }, gateway };
    },
  },
  {
    name: "openai key (installed package) only",
    build: () => ({ options: { keys: { openai: "sk-test" } } }),
  },
  {
    name: "nothing configured",
    build: () => ({ options: {} }),
  },
];

const modelStrings = ["openai/gpt-5.4-mini", "anthropic/claude-haiku-4-5", "vercel/openai/gpt-5.4-mini"];

function generatorSource(setup: Setup, modelString: string): Source {
  const { options, explicit, gateway } = setup.build();
  try {
    createModelResolver(options)(modelString);
  } catch {
    return "none";
  }
  if ((explicit?.asked.language ?? 0) > 0) return "explicit";
  if ((gateway?.asked.language ?? 0) > 0) return "gateway";
  // Neither fake was asked and resolution succeeded: an installed package,
  // which the generator path loads lazily on first call.
  return "package";
}

async function evaluationSource(setup: Setup, modelString: string): Promise<Source> {
  const { options, explicit, gateway } = setup.build();
  let model: { provider: string };
  try {
    model = await createModelResolver(options).resolveEvaluationModel!(modelString);
  } catch {
    return "none";
  }
  if ((explicit?.asked.evaluation ?? 0) > 0) return "explicit";
  if ((gateway?.asked.evaluation ?? 0) > 0) return "gateway";
  // The installed `@ai-sdk/openai` package's evaluation model.
  expect(model.provider).toMatch(/^openai/);
  return "package";
}

describe("createModelResolver — generator and evaluation paths pick the same source (D1)", () => {
  beforeEach(() => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const cases = setups.flatMap((setup) => modelStrings.map((modelString) => ({ setup, modelString })));

  it.each(cases.map((c) => [c.setup.name, c.modelString, c] as const))(
    "%s · %s",
    async (_setupName, _modelString, { setup, modelString }) => {
      const generator = generatorSource(setup, modelString);
      const evaluation = await evaluationSource(setup, modelString);
      expect(evaluation).toBe(generator);
    }
  );

  it("covers every source, so a path that always answered one way could not pass", async () => {
    const seen = new Set<Source>();
    for (const { setup, modelString } of cases) seen.add(generatorSource(setup, modelString));
    expect([...seen].sort()).toEqual(["explicit", "gateway", "none", "package"]);
  });

  it("the documented exception: typesafe-ai/jev is explicit for a generator but always the gateway for an evaluator (D2)", async () => {
    const setup: Setup = {
      name: "explicit typesafe-ai provider + gateway",
      build: () => {
        const explicit = explicitProvider("typesafe-ai");
        const gateway = gatewayInstance();
        return {
          options: { providers: { "typesafe-ai": explicit.provider }, gateways: { vercel: gateway.instance } },
          explicit,
          gateway,
        };
      },
    };
    expect(generatorSource(setup, "typesafe-ai/jev")).toBe("explicit");
    expect(await evaluationSource(setup, "typesafe-ai/jev")).toBe("gateway");
  });
});
