/**
 * Chat-agent assistant — the model is told today's date with the same block
 * every workforce worker gets, read on every turn.
 *
 * The assistant is a standalone generator, not a worker, so it composes
 * `workerDate` itself rather than writing a date line of its own: one way to
 * tell a model the date. Kitchen Sink runs as a long-lived server, so the
 * test also moves the clock after the module is imported and checks the
 * prompt carries the new day, not the import-time one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";
import { mockGenerator, testBlock } from "@flow-state-dev/testing";
import { workerDate } from "@flow-state-dev/workforce";
import { assistantGenerator } from "../flows/chat-agent/run/assistant/assistant";
import { artifactsCollection } from "../flows/chat-agent/shared/artifacts";
import { userStateSchema } from "../flows/chat-agent/shared/schemas";

const testFlow = defineFlow({
  kind: "chat-agent-todays-date-test",
  actions: {
    run: {
      inputSchema: z.object({
        message: z.string(),
        mode: z.enum(["ask", "build", "interview", "debate"]).default("ask"),
        thinkingStyle: z.enum(["default", "background-work"]).default("default"),
      }),
      block: assistantGenerator,
    },
  },
  session: {
    stateSchema: z.object({
      mode: z.enum(["ask", "build", "interview", "debate"]).default("ask"),
      thinkingStyle: z.enum(["default", "background-work"]).optional(),
      features: z.object({ biasCheck: z.boolean().default(false) }).default({}),
    }),
    resources: { artifacts: artifactsCollection },
  },
  user: { stateSchema: userStateSchema },
})({ id: "todays-date-test" });

const assistantFixture = mockGenerator({
  name: "assistant-generator",
  script: [{ text: "ok" }],
});

const observeFixture = mockGenerator({
  name: "memory/observe",
  script: [{ structuredOutput: { items: [] } }],
});

/** Runs one assistant turn and returns the messages the model was sent, serialized. */
async function runTurn(): Promise<string> {
  assistantFixture.reset();
  observeFixture.reset();
  const result = await testBlock(assistantGenerator, {
    input: {
      message: "what is today's date?",
      mode: "ask",
      thinkingStyle: "default",
      features: { biasCheck: false, search: true, fetch: true, crawl: false },
    },
    flow: testFlow,
    user: { state: { displayName: "Developer", thinkingEnabled: false } },
    session: {
      state: { mode: "ask", thinkingStyle: "default", features: { biasCheck: false } },
      resources: {
        workingMemory: { entries: [], currentTurn: 0 },
        memorySystem: {
          lastProcessedIndex: -1,
          episodicWritesSinceLastConsolidation: 0,
          evictedPersistentSinceLastConsolidation: 0,
          lastConsolidationTurn: 0,
        },
      },
    },
    generators: {
      "assistant-generator": assistantFixture,
      "memory/observe": observeFixture,
    },
    unmockedGeneratorPolicy: "allow",
  });
  expect(result.error).toBeNull();
  return JSON.stringify(assistantFixture.calls[0]?.input);
}

describe("chat-agent assistant date", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("tells the model the turn's date with the workforce date block, not the date the server started", async () => {
    // Two dates far from the real clock (and from each other), so neither can
    // match the import-time date by accident.
    const first = new Date(2031, 0, 15, 12);
    const second = new Date(2031, 5, 20, 12);

    vi.useFakeTimers({ toFake: ["Date"] });

    vi.setSystemTime(first);
    const firstBlock = workerDate();
    const firstPrompt = await runTurn();
    expect(firstPrompt).toContain(`<date>`);
    expect(firstPrompt).toContain(firstBlock);

    vi.setSystemTime(second);
    const secondPrompt = await runTurn();
    expect(secondPrompt).toContain(workerDate());
    expect(secondPrompt).not.toContain(firstBlock);
  });
});
