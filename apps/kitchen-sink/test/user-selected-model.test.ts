/**
 * Persisted user `selectedModel` — store load path and stale-id coalescing.
 *
 * Scope-record user state is loaded from the user store without Zod parsing
 * today; generators coalesce unknown ids at read time. These tests pin that
 * contract so a future load-time parse cannot regress to hard failures.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";
import { mockGenerator, testBlock } from "@flow-state-dev/testing";
import { assistantGenerator } from "../flows/chat-agent/run/assistant/assistant";
import { artifactsCollection } from "../flows/chat-agent/shared/artifacts";
import {
  persistedSelectedModelSchema,
  userStateSchema,
} from "../flows/chat-agent/shared/schemas";
import {
  DEFAULT_KITCHEN_SINK_MODEL,
} from "../lib/models";

const STALE_MODEL_ID = "vercel/removed/legacy-model";

const emptyWorkingMemory = { entries: [], currentTurn: 0 };
const emptyMemorySystem = {
  lastProcessedIndex: -1,
  episodicWritesSinceLastConsolidation: 0,
  evictedPersistentSinceLastConsolidation: 0,
  lastConsolidationTurn: 0,
};

const testFlow = defineFlow({
  kind: "chat-agent-stale-model-test",
  actions: {
    run: {
      inputSchema: z.object({
        message: z.string(),
        mode: z.enum(["ask", "build", "interview", "debate"]).default("ask"),
        thinkingStyle: z
          .enum(["auto", "default", "plan-and-execute", "supervisor", "routed-specialists"])
          .default("auto"),
      }),
      block: assistantGenerator,
    },
  },
  session: {
    stateSchema: z.object({
      mode: z.enum(["ask", "build", "interview", "debate"]).default("ask"),
      thinkingStyle: z
        .enum(["plan-and-execute", "supervisor", "routed-specialists", "default"])
        .optional(),
      features: z.object({ biasCheck: z.boolean().default(false) }).default({}),
    }),
    resources: {
      artifacts: artifactsCollection,
    },
  },
  user: {
    stateSchema: userStateSchema,
  },
})({ id: "stale-model-test" });

const assistantFixture = mockGenerator({
  name: "assistant-generator",
  script: [{ text: "ok" }],
});

const observeFixture = mockGenerator({
  name: "memory/observe",
  script: [{ structuredOutput: { items: [] } }],
});

describe("persisted user selectedModel", () => {
  it("coalesces stale ids when user state is parsed explicitly", () => {
    expect(
      persistedSelectedModelSchema.parse(STALE_MODEL_ID),
    ).toBe(DEFAULT_KITCHEN_SINK_MODEL);
    expect(
      userStateSchema.parse({
        selectedModel: STALE_MODEL_ID,
      }).selectedModel,
    ).toBe(DEFAULT_KITCHEN_SINK_MODEL);
  });

  it("loads stale ids from the user store and coalesces at generator read time", async () => {
    assistantFixture.reset();
    observeFixture.reset();

    const result = await testBlock(assistantGenerator, {
      input: { message: "hello", mode: "ask", thinkingStyle: "auto" },
      flow: testFlow,
      user: {
        state: {
          displayName: "Developer",
          selectedModel: STALE_MODEL_ID,
          thinkingEnabled: false,
        },
      },
      session: {
        state: {
          mode: "ask",
          thinkingStyle: "default",
          features: { biasCheck: false },
        },
        resources: {
          workingMemory: emptyWorkingMemory,
          memorySystem: emptyMemorySystem,
        },
      },
      generators: {
        "assistant-generator": assistantFixture,
        "memory/observe": observeFixture,
      },
      unmockedGeneratorPolicy: "allow",
    });

    expect(result.error).toBeNull();
    expect(assistantFixture.calls[0]?.model).toBe(DEFAULT_KITCHEN_SINK_MODEL);
    expect(result.state.user.selectedModel).toBe(STALE_MODEL_ID);
  });
});
