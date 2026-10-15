/**
 * The removed gateway/provider/model form throws, naming its colon spelling.
 * This file quotes that form, so the guard excludes it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModelResolver } from "../../src/models/createModelResolver";
import { parseModelString } from "../../src/models/providerDetection";

/** A gateway instance that records every id it is asked for. */
function recordingGateway() {
  const ids: string[] = [];
  return {
    ids,
    instance: {
      languageModel: (id: string) => {
        ids.push(id);
        throw new Error("no model expected");
      },
      evaluationModel: (id: string) => {
        ids.push(id);
        throw new Error("no model expected");
      },
    },
  };
}

beforeEach(() => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the slash multi-hop form is removed", () => {
  it("the parser rejects it, naming the colon spelling", () => {
    expect(() => parseModelString("vercel/openai/gpt-5.4")).toThrow(/"vercel:openai\/gpt-5\.4"/);
    expect(() => parseModelString("openrouter/anthropic/claude-sonnet-5")).toThrow(
      /"openrouter:anthropic\/claude-sonnet-5"/
    );
  });

  it("a block's string fails on first resolve, before any gateway call", () => {
    const gateway = recordingGateway();
    const resolver = createModelResolver({ gateways: { vercel: gateway.instance }, env: {} });

    expect(() => resolver("vercel/openai/gpt-5.4-mini")).toThrow(/"vercel:openai\/gpt-5\.4-mini"/);
    expect(() => resolver.resolveId("vercel/openai/gpt-5.4-mini")).toThrow(/"vercel:openai\/gpt-5\.4-mini"/);
    expect(gateway.ids).toEqual([]);
  });

  it("an evaluator's string fails before any provider call", async () => {
    const gateway = recordingGateway();
    const resolver = createModelResolver({ gateways: { vercel: gateway.instance }, env: {} });

    await expect(resolver.resolveEvaluationModel!("vercel/typesafe-ai/jev")).rejects.toThrow(
      /"vercel:typesafe-ai\/jev"/
    );
    expect(gateway.ids).toEqual([]);
  });

  it("a defaultModel fails when the resolver is built", () => {
    expect(() =>
      createModelResolver({ defaultModel: "vercel/anthropic/claude-sonnet-5", env: {} })
    ).toThrow(/"vercel:anthropic\/claude-sonnet-5"/);
  });

  it("an intent candidate fails when the resolver is built", () => {
    expect(() =>
      createModelResolver({
        intents: { utility: ["vercel/google/gemini-3.1-flash-lite"] },
        defaultModel: "openai/gpt-5.4-mini",
        env: {},
      })
    ).toThrow(/"vercel:google\/gemini-3\.1-flash-lite"/);
  });

  it("an env-var override fails when the resolver is built, naming the variable", () => {
    expect(() =>
      createModelResolver({ env: { FSDEV_DEFAULT_MODEL: "vercel/openai/gpt-5.4-mini" } })
    ).toThrow(/FSDEV_DEFAULT_MODEL.*"vercel:openai\/gpt-5\.4-mini"/s);
  });
});
