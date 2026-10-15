/**
 * Colon routes on hand-built instances that record the id they are asked for.
 * Ambient keys are cleared so the host's own cannot leak in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { createModelResolver } from "../../src/models/createModelResolver";
import { evaluationModelGateway } from "../../src/models/evaluationModelGateway";
import { extractProviderName } from "../../src/models/providerDetection";

const messages = [{ role: "user" as const, content: "hi" }];

function textModel(text: string) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

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

/** A gateway or provider instance that records every id it is asked for. */
function recordingSource(label: string) {
  const languageModelIds: string[] = [];
  const evaluationModelIds: string[] = [];
  return {
    languageModelIds,
    evaluationModelIds,
    instance: {
      languageModel: (id: string) => {
        languageModelIds.push(id);
        return textModel(`${label}:${id}`);
      },
      evaluationModel: (id: string) => {
        evaluationModelIds.push(id);
        return evaluationModel(label, id);
      },
    },
  };
}

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

describe("createModelResolver — colon lane (generators)", () => {
  it("routes gateway:provider/model to that gateway with everything after the colon as its id", async () => {
    const gateway = recordingSource("vercel");
    const resolver = createModelResolver({ gateways: { vercel: gateway.instance }, env: {} });

    const result = await resolver("vercel:anthropic/claude-sonnet-5").generate({ messages });

    expect(gateway.languageModelIds).toEqual(["anthropic/claude-sonnet-5"]);
    expect(result.text).toBe("vercel:anthropic/claude-sonnet-5");
    expect(result.resolvedIdentity?.gateway).toBe("vercel");
  });

  it("passes a model id that carries its own colon to the gateway untouched", async () => {
    const gateway = recordingSource("router");
    // A gateway key of the app's own choosing is a route name too.
    const resolver = createModelResolver({ gateways: { router: gateway.instance }, env: {} });

    await resolver("router:openai/gpt-oss-20b:free").generate({ messages });

    expect(gateway.languageModelIds).toEqual(["openai/gpt-oss-20b:free"]);
  });

  it("routes a name registered under providers to that provider, pinned, with no gateway in its identity", async () => {
    const triage = recordingSource("triage");
    const gateway = recordingSource("vercel");
    const resolver = createModelResolver({
      providers: { triage: triage.instance },
      gateways: { vercel: gateway.instance },
      env: {},
    });

    const result = await resolver("triage:native").generate({ messages });

    expect(triage.languageModelIds).toEqual(["native"]);
    expect(gateway.languageModelIds).toEqual([]);
    expect(result.resolvedIdentity?.gateway).toBeUndefined();
  });

  it("never falls through to a gateway for a built-in provider named with a colon", () => {
    const gateway = recordingSource("vercel");
    const resolver = createModelResolver({ gateways: { vercel: gateway.instance }, env: {} });

    expect(() => resolver("openai:gpt-5.4-mini")).toThrow(/OPENAI_API_KEY/);
    expect(gateway.languageModelIds).toEqual([]);
  });

  it("keeps a bare provider/model falling through to a configured gateway (FIX-609, D1)", async () => {
    const gateway = recordingSource("vercel");
    const resolver = createModelResolver({ gateways: { vercel: gateway.instance }, env: {} });

    await resolver("openai/gpt-5.4-mini").generate({ messages });

    expect(gateway.languageModelIds).toEqual(["openai/gpt-5.4-mini"]);
  });

  it("refuses a name that is neither a provider nor a gateway, listing the names it knows", () => {
    const resolver = createModelResolver({ env: {} });
    expect(() => resolver("nobody:model-x")).toThrow(/"nobody".*providers.*gateways/s);
  });

  it("orders intent candidates by the provider the classifier reads, not the gateway name", () => {
    const gateway = recordingSource("vercel");
    const resolver = createModelResolver({
      gateways: { vercel: gateway.instance },
      intents: { chat: ["vercel:openai/gpt-5.4-mini", "vercel:anthropic/claude-sonnet-5"] },
      defaultModel: "vercel:openai/gpt-5.4-mini",
      env: {},
    });

    expect(resolver.resolveId("intent/chat", { preferProvider: "anthropic" })).toBe(
      "vercel:anthropic/claude-sonnet-5"
    );
  });

  it("names the provider of a colon string from the app's maps", () => {
    const resolver = createModelResolver({
      providers: { triage: recordingSource("triage").instance },
      gateways: { vercel: recordingSource("vercel").instance },
      env: {},
    });

    expect(resolver.providerOf?.("vercel:anthropic/claude-sonnet-5")).toBe("anthropic");
    expect(resolver.providerOf?.("triage:org/native")).toBe("triage");
    expect(resolver.providerOf?.("openai/gpt-5.4")).toBe("openai");
  });
});

describe("createModelResolver — colon lane (evaluators)", () => {
  it("resolves gateway:provider/model through the gateway's evaluation model and records the gateway", async () => {
    const gateway = recordingSource("vercel");
    const resolver = createModelResolver({ gateways: { vercel: gateway.instance }, env: {} });

    const model = await resolver.resolveEvaluationModel!("vercel:typesafe-ai/jev");

    expect(gateway.evaluationModelIds).toEqual(["typesafe-ai/jev"]);
    expect(evaluationModelGateway(model)).toBe("vercel");
  });

  it("resolves a registered name:model through that provider's evaluation model, with no gateway", async () => {
    const triage = recordingSource("triage");
    const gateway = recordingSource("vercel");
    const resolver = createModelResolver({
      providers: { triage: triage.instance },
      gateways: { vercel: gateway.instance },
      env: {},
    });

    const model = await resolver.resolveEvaluationModel!("triage:native");

    expect(triage.evaluationModelIds).toEqual(["native"]);
    expect(gateway.evaluationModelIds).toEqual([]);
    expect(evaluationModelGateway(model)).toBeUndefined();
  });

  it("reaches a registered typesafe-ai library only through the colon form (FIX-1554 D2 stays)", async () => {
    const typesafe = recordingSource("typesafe-ai");
    const gateway = recordingSource("vercel");
    const resolver = createModelResolver({
      providers: { "typesafe-ai": typesafe.instance },
      gateways: { vercel: gateway.instance },
      env: {},
    });

    await resolver.resolveEvaluationModel!("typesafe-ai:jev-latest");
    await resolver.resolveEvaluationModel!("typesafe-ai/jev");

    expect(typesafe.evaluationModelIds).toEqual(["jev-latest"]);
    expect(gateway.evaluationModelIds).toEqual(["typesafe-ai/jev"]);
  });

});

describe("createModelResolver — route names are own keys only", () => {
  // A route name comes from a caller's string, so a name an object inherits
  // (`constructor`, `toString`) must never count as registered.
  it.each(["constructor:foo", "toString:x/y", "hasOwnProperty:m"])("refuses %s as an unknown route", (model) => {
    const resolver = createModelResolver({ providers: {}, gateways: {}, env: {} });
    expect(() => resolver(model)).toThrow(/Unknown route/);
  });

  it("refuses an inherited name in config when the resolver is built", () => {
    expect(() =>
      createModelResolver({ intents: { chat: ["constructor:foo"] }, defaultModel: "openai/gpt-5.4", env: {} })
    ).toThrow(/Unknown route "constructor"/);
  });

  it("names no provider for an inherited route name", () => {
    const resolver = createModelResolver({ env: {} });
    expect(resolver.providerOf?.("toString:x/y")).toBe("unknown");
    expect(resolver.providerOf?.("constructor:foo")).toBe("unknown");
  });

  it("refuses an evaluator string whose route name is inherited", async () => {
    const resolver = createModelResolver({ env: {} });
    await expect(resolver.resolveEvaluationModel!("constructor:foo")).rejects.toThrow(/Unknown route/);
  });
});

describe("createModelResolver — one route per string, whatever the caller", () => {
  it("resolves triage:native to the same provider for a generator and an evaluator", async () => {
    const triage = recordingSource("triage");
    const gateway = recordingSource("vercel");
    const resolver = createModelResolver({
      providers: { triage: triage.instance },
      gateways: { vercel: gateway.instance },
      env: {},
    });

    const text = await resolver("triage:native").generate({ messages });
    const evaluation = await resolver.resolveEvaluationModel!("triage:native");

    expect(text.text).toBe("triage:native");
    expect(evaluation.provider).toBe("triage");
    expect(triage.languageModelIds).toEqual(["native"]);
    expect(triage.evaluationModelIds).toEqual(["native"]);
    expect(gateway.languageModelIds).toEqual([]);
    expect(gateway.evaluationModelIds).toEqual([]);
  });

  // resolveId reports the string a block will run on, so it must refuse the
  // route that generator and evaluator resolution refuse, not echo it back.
  it("resolveId refuses an unregistered route the way resolving it does", () => {
    const resolver = createModelResolver({
      providers: { triage: recordingSource("triage").instance },
      env: {},
    });

    expect(() => resolver("missing:model")).toThrow(/Unknown route "missing"/);
    expect(() => resolver.resolveId("missing:model")).toThrow(/Unknown route "missing"/);
    expect(resolver.resolveId("triage:native")).toBe("triage:native");
    expect(resolver.resolveId("vercel:anthropic/claude-sonnet-5")).toBe("vercel:anthropic/claude-sonnet-5");
  });

  // extractProviderName is the config-free guess a resolver without
  // providerOf falls back to. On every string whose route does not depend on
  // the app's maps, the two must agree.
  it.each([
    "openai/gpt-5.4",
    "anthropic/claude-sonnet-4-6",
    "vercel:anthropic/claude-sonnet-5",
    "openrouter:openai/gpt-oss-20b:free",
    "openai:gpt-5.4",
    "google:gemini-3",
    "intent/chat",
  ])("providerOf and extractProviderName agree on %s", (model) => {
    const resolver = createModelResolver({
      intents: { chat: ["openai/gpt-5.4"] },
      defaultModel: "openai/gpt-5.4",
      env: {},
    });
    expect(resolver.providerOf?.(model)).toBe(extractProviderName(model));
  });
});

describe("createModelResolver — one name, one map (D2)", () => {
  it("refuses a name that is a key of both providers and gateways, naming both places", () => {
    const source = recordingSource("x").instance;
    expect(() =>
      createModelResolver({ providers: { acme: source }, gateways: { acme: source }, env: {} })
    ).toThrow(/"acme".*providers.*gateways/s);
  });

  it.each(["vercel", "openrouter"])("refuses a providers key named like the built-in gateway %s", (name) => {
    expect(() =>
      createModelResolver({ providers: { [name]: recordingSource("x").instance }, env: {} })
    ).toThrow(new RegExp(`"${name}".*providers.*gateway`, "s"));
  });
});

describe("createModelResolver — colon config strings are checked at startup", () => {
  it("refuses a colon config string whose name the app never set up, when built", () => {
    expect(() =>
      createModelResolver({
        intents: { utility: ["acme:fast"] },
        defaultModel: "openai/gpt-5.4-mini",
        env: {},
      })
    ).toThrow(/"acme"/);
  });

  it("accepts colon config strings for built-in and registered names", () => {
    expect(() =>
      createModelResolver({
        providers: { triage: recordingSource("triage").instance },
        intents: { utility: ["vercel:google/gemini-3.1-flash-lite", "openai:gpt-5.4-nano", "triage:native"] },
        defaultModel: "vercel:anthropic/claude-sonnet-5",
        env: {},
      })
    ).not.toThrow();
  });
});
