// FIX-2520.
/**
 * What a generator's model call names as its target for the person's files:
 * what the model's provider reads. An intent names no provider in its
 * string, so its target comes from each candidate it resolves to; a
 * provider not in the table reads images only, and gets a PDF's text.
 */
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { generator } from "../src";
import { ATTACHMENT_IMAGE_TYPES } from "../src/attachments";
import { createModelResolver } from "../src/models/createModelResolver";
import { createMockContext, runForTest } from "./helpers";

function textSource() {
  return {
    languageModel: () =>
      new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [{ type: "text", text: "ok" }],
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

/** A resolver whose run prepares messages, recording each call's target. */
function recordingResolver() {
  const resolver = createModelResolver({
    gateways: { vercel: textSource() },
    intents: { chat: ["vercel:anthropic/claude-sonnet-5"], house: ["vercel:acme/house-model"] },
    defaultModel: "vercel:anthropic/claude-sonnet-5",
    env: {},
  });
  const targets: unknown[] = [];
  resolver.prepareMessages = vi.fn(async (messages: unknown[], target?: unknown) => {
    targets.push(target);
    return messages;
  });
  return { resolver, targets };
}

async function targetFor(model: string) {
  const { resolver, targets } = recordingResolver();
  const block = generator({ name: "answer", model, prompt: "Answer" });
  await runForTest(block, { value: "x" }, createMockContext({ resolveModel: resolver }));
  return targets[0] as { accepts: readonly string[] } | undefined;
}

describe("a generator's file target", () => {
  it("reads PDFs for an intent whose candidate's provider reads them", async () => {
    expect((await targetFor("intent/chat"))?.accepts).toContain("application/pdf");
  });

  it("reads images only for an intent whose candidate's provider is not in the table", async () => {
    expect((await targetFor("intent/house"))?.accepts).toEqual(ATTACHMENT_IMAGE_TYPES);
  });

  it("reads PDFs for a model string that names a provider that reads them", async () => {
    expect((await targetFor("vercel:openai/gpt-6-luna"))?.accepts).toContain("application/pdf");
  });
});
