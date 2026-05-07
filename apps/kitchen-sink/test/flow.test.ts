import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";
import {
  mockGenerator,
  testBlock,
  testRouter
} from "@flow-state-dev/testing";
import { thinkingStyleRouter } from "../flows/chat-agent/flow";
import { artifactsCollection } from "../flows/chat-agent/blocks/artifacts";

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const info = statSync(fullPath);

    if (info.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

const emptyWorkingMemory = { entries: [], currentTurn: 0 };
const emptyMemorySystem = {
  lastProcessedIndex: -1,
  episodicWritesSinceLastConsolidation: 0,
  evictedPersistentSinceLastConsolidation: 0,
  lastConsolidationTurn: 0,
};

// Minimal flow instance with artifacts collection for testBlock.
const testFlow = defineFlow({
  kind: "chat-agent-test",
  actions: {
    run: {
      inputSchema: z.object({
        message: z.string(),
        mode: z.enum(["ask", "build", "interview", "debate"]).default("ask"),
        thinkingStyle: z.enum(["auto", "default", "plan-and-execute", "supervisor", "routed-specialists"]).default("auto"),
      }),
      block: thinkingStyleRouter,
    },
  },
  session: {
    stateSchema: z.object({
      mode: z.enum(["ask", "build", "interview", "debate"]).default("ask"),
      thinkingStyle: z.enum(["plan-and-execute", "supervisor", "routed-specialists", "default"]).optional(),
      requestCount: z.number().default(0),
      lastAction: z.string().optional(),
      features: z.object({ biasCheck: z.boolean().default(false) }).default({}),
    }),
    resources: {
      artifacts: artifactsCollection,
    },
  },
  user: {
    stateSchema: z.object({
      displayName: z.string().default("Developer"),
      preferredModel: z.string().default("preset/small"),
    }),
  },
})({ id: "test" });

const assistantFixture = mockGenerator({
  name: "assistant-generator",
  script: [
    { text: "Here is what I found." }
  ]
});

const observeFixture = mockGenerator({
  name: "tf.memory/observe",
  script: [
    { structuredOutput: { items: [] } }
  ]
});

describe("chat-agent flow", () => {
  it("routes to default-pipeline for default style", async () => {
    assistantFixture.reset();
    observeFixture.reset();
    const routed = await testRouter(thinkingStyleRouter, {
      input: { message: "Help me", mode: "ask", thinkingStyle: "auto" },
      flow: testFlow,
      session: {
        state: { thinkingStyle: "default", features: { biasCheck: false } },
        resources: { workingMemory: emptyWorkingMemory, memorySystem: emptyMemorySystem },
      },
      generators: { "assistant-generator": assistantFixture, "tf.memory/observe": observeFixture },
    });
    expect(routed.error).toBeNull();
    expect(routed.selectedRoute).toBe("assistant-generator");
  });

  it("routes to pae-pipeline for plan-and-execute style", async () => {
    const routed = await testRouter(thinkingStyleRouter, {
      input: { message: "Build a report", mode: "ask", thinkingStyle: "auto" },
      flow: testFlow,
      session: {
        state: { thinkingStyle: "plan-and-execute", features: { biasCheck: false } },
        resources: { workingMemory: emptyWorkingMemory, memorySystem: emptyMemorySystem },
      },
      unmockedGeneratorPolicy: "warn",
    });
    // PaE pipeline requires planner/executor mocks — we only verify route selection.
    expect(routed.selectedRoute).toBe("pae-thinking");
  });

  it("routes to supervisor-pipeline for supervisor style", async () => {
    const routed = await testRouter(thinkingStyleRouter, {
      input: { message: "Coordinate reviews", mode: "ask", thinkingStyle: "auto" },
      flow: testFlow,
      session: {
        state: { thinkingStyle: "supervisor", features: { biasCheck: false } },
        resources: { workingMemory: emptyWorkingMemory, memorySystem: emptyMemorySystem },
      },
      unmockedGeneratorPolicy: "warn",
    });
    expect(routed.selectedRoute).toBe("supervisor-thinking");
  });

  it("routes to routed-specialists-pipeline for routed-specialists style", async () => {
    const routed = await testRouter(thinkingStyleRouter, {
      input: { message: "Analyze this from multiple perspectives", mode: "ask", thinkingStyle: "auto" },
      flow: testFlow,
      session: {
        state: { thinkingStyle: "routed-specialists", features: { biasCheck: false } },
        resources: { workingMemory: emptyWorkingMemory, memorySystem: emptyMemorySystem },
      },
      unmockedGeneratorPolicy: "warn",
    });
    expect(routed.selectedRoute).toBe("routedSpecialists-thinking");
  });

  it("defaults to default-pipeline when thinkingStyle is not set", async () => {
    assistantFixture.reset();
    observeFixture.reset();
    const routed = await testRouter(thinkingStyleRouter, {
      input: { message: "Hello", mode: "ask", thinkingStyle: "auto" },
      flow: testFlow,
      session: {
        state: { features: { biasCheck: false } },
        resources: { workingMemory: emptyWorkingMemory, memorySystem: emptyMemorySystem },
      },
      generators: { "assistant-generator": assistantFixture, "tf.memory/observe": observeFixture },
    });
    expect(routed.error).toBeNull();
    expect(routed.selectedRoute).toBe("assistant-generator");
  });

  it("completes a chat action via default-pipeline", async () => {
    assistantFixture.reset();
    observeFixture.reset();
    const result = await testBlock(thinkingStyleRouter, {
      input: { message: "Hello kitchen sink", mode: "ask", thinkingStyle: "auto" },
      flow: testFlow,
      session: {
        state: { thinkingStyle: "default", features: { biasCheck: false } },
        resources: { workingMemory: emptyWorkingMemory, memorySystem: emptyMemorySystem },
      },
      generators: { "assistant-generator": assistantFixture, "tf.memory/observe": observeFixture }
    });

    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  it("reads preferredModel from user state", async () => {
    assistantFixture.reset();
    observeFixture.reset();
    const result = await testBlock(thinkingStyleRouter, {
      input: { message: "Test with custom model", mode: "ask", thinkingStyle: "auto" },
      flow: testFlow,
      session: {
        state: { thinkingStyle: "default", features: { biasCheck: false } },
        resources: { workingMemory: emptyWorkingMemory, memorySystem: emptyMemorySystem },
      },
      user: {
        state: {
          displayName: "TestUser",
          preferredModel: "gpt-4o"
        }
      },
      generators: { "assistant-generator": assistantFixture, "tf.memory/observe": observeFixture }
    });

    expect(result.error).toBeNull();
  });

  it("emits block_output items", async () => {
    assistantFixture.reset();
    observeFixture.reset();
    const result = await testBlock(thinkingStyleRouter, {
      input: { message: "Check items", mode: "ask", thinkingStyle: "auto" },
      flow: testFlow,
      session: {
        state: { thinkingStyle: "default", features: { biasCheck: false } },
        resources: { workingMemory: emptyWorkingMemory, memorySystem: emptyMemorySystem },
      },
      generators: { "assistant-generator": assistantFixture, "tf.memory/observe": observeFixture }
    });

    const blockOutputs = result.items.filter((item) => item.type === "block_trace");
    expect(blockOutputs.length).toBeGreaterThan(0);
  });

  it("seeds session resources for artifact access", async () => {
    assistantFixture.reset();
    observeFixture.reset();
    const result = await testBlock(thinkingStyleRouter, {
      input: { message: "Read artifact doc-1", mode: "ask", thinkingStyle: "auto" },
      flow: testFlow,
      session: {
        state: { mode: "ask", thinkingStyle: "default", requestCount: 0, features: { biasCheck: false } },
        resources: {
          "artifacts/doc-1": {
            title: "Test Document",
            summary: "Test content summary",
            updatedAt: 1000
          },
          workingMemory: emptyWorkingMemory,
          memorySystem: emptyMemorySystem,
        }
      },
      generators: { "assistant-generator": assistantFixture, "tf.memory/observe": observeFixture }
    });

    expect(result.error).toBeNull();
  });

  it("supports scripted mockGenerator fixtures", () => {
    const scripted = mockGenerator({
      name: "assistant-generator",
      script: [
        { text: "Scripted reply" }
      ]
    });

    expect(scripted.next()?.text).toBe("Scripted reply");
    scripted.reset();
    expect(scripted.next()).toBeDefined();
  });

  it("routes interview mode through default-pipeline", async () => {
    assistantFixture.reset();
    observeFixture.reset();
    const routed = await testRouter(thinkingStyleRouter, {
      input: { message: "Tell me about your project", mode: "interview", thinkingStyle: "auto" },
      flow: testFlow,
      session: {
        state: { mode: "interview", thinkingStyle: "default", features: { biasCheck: false } },
        resources: { workingMemory: emptyWorkingMemory, memorySystem: emptyMemorySystem },
      },
      generators: { "assistant-generator": assistantFixture, "tf.memory/observe": observeFixture },
    });
    expect(routed.error).toBeNull();
    expect(routed.selectedRoute).toBe("assistant-generator");
  });

  it("routes debate mode through default-pipeline", async () => {
    assistantFixture.reset();
    observeFixture.reset();
    const routed = await testRouter(thinkingStyleRouter, {
      input: { message: "I think React is better than Vue", mode: "debate", thinkingStyle: "auto" },
      flow: testFlow,
      session: {
        state: { mode: "debate", thinkingStyle: "default", features: { biasCheck: false } },
        resources: { workingMemory: emptyWorkingMemory, memorySystem: emptyMemorySystem },
      },
      generators: { "assistant-generator": assistantFixture, "tf.memory/observe": observeFixture },
    });
    expect(routed.error).toBeNull();
    expect(routed.selectedRoute).toBe("assistant-generator");
  });

  it("completes a chat action in interview mode", async () => {
    assistantFixture.reset();
    observeFixture.reset();
    const result = await testBlock(thinkingStyleRouter, {
      input: { message: "Let's explore my project requirements", mode: "interview", thinkingStyle: "auto" },
      flow: testFlow,
      session: {
        state: { mode: "interview", thinkingStyle: "default", features: { biasCheck: false } },
        resources: { workingMemory: emptyWorkingMemory, memorySystem: emptyMemorySystem },
      },
      generators: { "assistant-generator": assistantFixture, "tf.memory/observe": observeFixture },
    });
    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  it("completes a chat action in debate mode", async () => {
    assistantFixture.reset();
    observeFixture.reset();
    const result = await testBlock(thinkingStyleRouter, {
      input: { message: "Microservices are always better than monoliths", mode: "debate", thinkingStyle: "auto" },
      flow: testFlow,
      session: {
        state: { mode: "debate", thinkingStyle: "default", features: { biasCheck: false } },
        resources: { workingMemory: emptyWorkingMemory, memorySystem: emptyMemorySystem },
      },
      generators: { "assistant-generator": assistantFixture, "tf.memory/observe": observeFixture },
    });
    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  it("contains no legacy part-rendering terminology", () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const flowDir = join(root, "../flows/chat-agent");
    const sourceFiles = collectSourceFiles(flowDir);
    const legacyRendererTerm = new RegExp(`\\b${"Part"}${"Renderer"}\\b`);
    const legacyPartsTerm = new RegExp(`\\${"."}${"parts"}\\b`);

    for (const sourceFile of sourceFiles) {
      const content = readFileSync(sourceFile, "utf8");
      expect(content).not.toMatch(legacyRendererTerm);
      expect(content).not.toMatch(legacyPartsTerm);
    }
  });
});
