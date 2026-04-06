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
import { modeRouter } from "../src/flows/kitchen-sink/flow";
import { artifactsCollection } from "../src/flows/kitchen-sink/schemas";

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

// Minimal flow instance with the artifacts collection so testBlock creates
// proper ResourceCollectionRef instances via createExecutionContext.
const testFlow = defineFlow({
  kind: "kitchen-sink-test",
  actions: {
    run: {
      inputSchema: z.object({
        message: z.string(),
        mode: z.enum(["chat", "create", "plan"]).default("chat"),
        thinkingStyle: z.enum(["auto", "plan-and-execute", "supervisor", "chain-of-thought"]).default("auto"),
      }),
      block: modeRouter,
    },
  },
  session: {
    stateSchema: z.object({
      mode: z.enum(["chat", "create", "plan"]).default("chat"),
      thinkingStyle: z.enum(["plan-and-execute", "supervisor", "chain-of-thought"]).optional(),
      requestCount: z.number().default(0),
      lastAction: z.string().optional(),
    }),
    resources: {
      artifacts: artifactsCollection,
    },
  },
  user: {
    stateSchema: z.object({
      displayName: z.string().default("Developer"),
      preferredModel: z.string().default("openai/gpt-5.4-mini"),
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

const plannerFixture = mockGenerator({
  name: "plan-mode-planner",
  script: [
    { structuredOutput: { tasks: [{ id: "t1", goal: "Research the topic", deps: [] }] } }
  ]
});

const planExecutorFixture = mockGenerator({
  name: "plan-mode-executor",
  script: [
    { structuredOutput: { summary: "Found relevant information.", success: true } }
  ]
});

const planSynthesizerFixture = mockGenerator({
  name: "plan-mode-synthesizer",
  script: [
    { text: "Here is a synthesis of the findings." }
  ]
});

describe("kitchen-sink flow", () => {
  it("completes a chat action via modeRouter", async () => {
    const result = await testBlock(modeRouter, {
      input: { message: "Hello kitchen sink", mode: "chat" },
      flow: testFlow,
      session: { resources: { workingMemory: emptyWorkingMemory, memorySystem: emptyMemorySystem } },
      generators: { "assistant-generator": assistantFixture, "tf.memory/observe": observeFixture }
    });

    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  it("routes to plan pipeline when mode is plan", async () => {
    assistantFixture.reset();
    observeFixture.reset();
    plannerFixture.reset();
    planExecutorFixture.reset();
    planSynthesizerFixture.reset();
    const result = await testBlock(modeRouter, {
      input: { message: "Create a deployment plan", mode: "plan" },
      flow: testFlow,
      session: { resources: { workingMemory: emptyWorkingMemory, memorySystem: emptyMemorySystem } },
      generators: {
        "assistant-generator": assistantFixture,
        "tf.memory/observe": observeFixture,
        "plan-mode-planner": plannerFixture,
        "plan-mode-executor": planExecutorFixture,
        "plan-mode-synthesizer": planSynthesizerFixture,
      }
    });

    expect(result.error).toBeNull();
  });

  it("routes to plan pipeline based on input mode", async () => {
    plannerFixture.reset();
    planExecutorFixture.reset();
    planSynthesizerFixture.reset();
    const routed = await testRouter(modeRouter, {
      input: { message: "Continue working", mode: "plan" },
      flow: testFlow,
      generators: {
        "plan-mode-planner": plannerFixture,
        "plan-mode-executor": planExecutorFixture,
        "plan-mode-synthesizer": planSynthesizerFixture,
      }
    });

    expect(routed.error).toBeNull();
    expect(routed.selectedRoute).toBe("plan-pipeline");
  });

  it("routes to assistant pipeline for chat and create modes", async () => {
    const chatRouted = await testRouter(modeRouter, {
      input: { message: "Help me", mode: "chat" },
      flow: testFlow,
    });
    expect(chatRouted.selectedRoute).toBe("assistant-pipeline");

    const createRouted = await testRouter(modeRouter, {
      input: { message: "Build something", mode: "create" },
      flow: testFlow,
    });
    expect(createRouted.selectedRoute).toBe("assistant-pipeline");
  });

  it("reads preferredModel from user state", async () => {
    assistantFixture.reset();
    observeFixture.reset();
    const result = await testBlock(modeRouter, {
      input: { message: "Test with custom model", mode: "chat" },
      flow: testFlow,
      session: { resources: { workingMemory: emptyWorkingMemory, memorySystem: emptyMemorySystem } },
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
    const result = await testBlock(modeRouter, {
      input: { message: "Check items", mode: "chat" },
      flow: testFlow,
      session: { resources: { workingMemory: emptyWorkingMemory, memorySystem: emptyMemorySystem } },
      generators: { "assistant-generator": assistantFixture, "tf.memory/observe": observeFixture }
    });

    const blockOutputs = result.items.filter((item) => item.type === "block_output");
    expect(blockOutputs.length).toBeGreaterThan(0);
  });

  it("seeds session resources for artifact access", async () => {
    assistantFixture.reset();
    observeFixture.reset();
    const result = await testBlock(modeRouter, {
      input: { message: "Read artifact doc-1", mode: "chat" },
      flow: testFlow,
      session: {
        state: { mode: "chat", requestCount: 0 },
        resources: {
          "artifacts/doc-1": {
            title: "Test Document",
            summary: "Test content summary",
            updatedAt: 1000
          },
          workingMemory: emptyWorkingMemory,
          memorySystem: emptyMemorySystem
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

  it("contains no legacy part-rendering terminology", () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const srcDir = join(root, "../src");
    const sourceFiles = collectSourceFiles(srcDir);
    const legacyRendererTerm = new RegExp(`\\b${"Part"}${"Renderer"}\\b`);
    const legacyPartsTerm = new RegExp(`\\${"."}${"parts"}\\b`);

    for (const sourceFile of sourceFiles) {
      const content = readFileSync(sourceFile, "utf8");
      expect(content).not.toMatch(legacyRendererTerm);
      expect(content).not.toMatch(legacyPartsTerm);
    }
  });
});
