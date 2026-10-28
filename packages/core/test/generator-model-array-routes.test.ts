/** Model-array labels come from the resolver's providerOf, which sees the app's maps. */
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { generator } from "../src";
import { createModelResolver } from "../src/models/createModelResolver";
import { createMockContext, runForTest } from "./helpers";

function textSource(label: string) {
  return {
    languageModel: (id: string) =>
      new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [{ type: "text", text: `${label}:${id}` }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
          },
          warnings: [],
        }),
      }),
  };
}

describe("generator model array with named routes", () => {
  it("runs the first entry of an array of colon strings through the route it names", async () => {
    const resolver = createModelResolver({
      providers: { triage: textSource("triage") },
      gateways: { vercel: textSource("vercel") },
      env: {},
    });
    const block = generator({
      name: "routes",
      model: ["triage:native", "vercel:openai/gpt-5.4-mini"],
      prompt: "Answer",
    });

    await expect(runForTest(block, { value: "x" }, createMockContext({ resolveModel: resolver }))).resolves.toBe(
      "triage:native"
    );
  });

  it("labels each entry with the provider the resolver classifies, not a parse of the string", async () => {
    const resolver = createModelResolver({
      providers: { triage: textSource("triage") },
      gateways: { vercel: textSource("vercel") },
      env: {},
    });
    const providerOf = vi.spyOn(resolver, "providerOf" as never) as unknown as ReturnType<typeof vi.fn>;
    const block = generator({
      name: "routes",
      model: ["vercel:anthropic/claude-sonnet-5", "triage:org/native"],
      prompt: "Answer",
    });

    await runForTest(block, { value: "x" }, createMockContext({ resolveModel: resolver }));

    expect(providerOf.mock.results.map((r) => r.value)).toEqual(["anthropic", "triage"]);
  });
});
