import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  mockGenerator,
  testBlock,
  testRouter
} from "@flow-state-dev/testing";
import { modeRouter } from "../src/flows/kitchen-sink/flow";
import { analyzeInput } from "../src/flows/kitchen-sink/blocks";

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

const emptyArtifacts = { byId: {}, order: [] as string[] };
const emptyWorkingMemory = { entries: [], currentTurn: 0 };

const agentFixture = mockGenerator({
  name: "agent-generator",
  script: [
    { text: "Here is what I found." }
  ]
});

const observeFixture = mockGenerator({
  name: "workingMemory/observe",
  script: [
    { structuredOutput: { observations: [] } }
  ]
});

describe("kitchen-sink flow", () => {
  it("completes a chat action via modeRouter", async () => {
    const result = await testBlock(modeRouter, {
      input: { message: "Hello kitchen sink", mode: "chat" },
      session: { resources: { artifacts: emptyArtifacts, workingMemory: emptyWorkingMemory } },
      generators: { "agent-generator": agentFixture, "workingMemory/observe": observeFixture }
    });

    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  it("routes to plan pipeline when mode is plan", async () => {
    agentFixture.reset();
    observeFixture.reset();
    const result = await testBlock(modeRouter, {
      input: { message: "Create a deployment plan", mode: "plan" },
      session: { resources: { artifacts: emptyArtifacts, workingMemory: emptyWorkingMemory } },
      generators: { "agent-generator": agentFixture, "workingMemory/observe": observeFixture }
    });

    expect(result.error).toBeNull();
  });

  it("routes based on session state mode", async () => {
    const routed = await testRouter(modeRouter, {
      input: { message: "Continue working", mode: "chat" },
      session: {
        state: { mode: "plan", requestCount: 3 }
      }
    });

    expect(routed.error).toBeNull();
    expect(routed.selectedRoute).toBe("plan-pipeline");
  });

  it("reads preferredModel from user state", async () => {
    agentFixture.reset();
    observeFixture.reset();
    const result = await testBlock(modeRouter, {
      input: { message: "Test with custom model", mode: "chat" },
      session: { resources: { artifacts: emptyArtifacts, workingMemory: emptyWorkingMemory } },
      user: {
        state: {
          displayName: "TestUser",
          preferredModel: "gpt-4o"
        }
      },
      generators: { "agent-generator": agentFixture, "workingMemory/observe": observeFixture }
    });

    expect(result.error).toBeNull();
  });

  it("emits block_output items", async () => {
    agentFixture.reset();
    observeFixture.reset();
    const result = await testBlock(modeRouter, {
      input: { message: "Check items", mode: "chat" },
      session: { resources: { artifacts: emptyArtifacts, workingMemory: emptyWorkingMemory } },
      generators: { "agent-generator": agentFixture, "workingMemory/observe": observeFixture }
    });

    const blockOutputs = result.items.filter((item) => item.type === "block_output");
    expect(blockOutputs.length).toBeGreaterThan(0);
  });

  it("seeds session resources for artifact access", async () => {
    agentFixture.reset();
    observeFixture.reset();
    const result = await testBlock(modeRouter, {
      input: { message: "Read artifact doc-1", mode: "chat" },
      session: {
        state: { mode: "chat", requestCount: 0 },
        resources: {
          artifacts: {
            byId: {
              "doc-1": {
                id: "doc-1",
                title: "Test Document",
                content: "This is test content.",
                updatedAt: 1000
              }
            },
            order: ["doc-1"]
          },
          workingMemory: emptyWorkingMemory
        }
      },
      generators: { "agent-generator": agentFixture, "workingMemory/observe": observeFixture }
    });

    expect(result.error).toBeNull();
  });

  it("analyzeInput classifies short messages", async () => {
    const result = await testBlock(analyzeInput, {
      input: { message: "short", mode: "chat" },
      session: {
        state: { mode: "chat" }
      }
    });

    expect(result.output.needsContext).toBe(false);
    expect(result.output.mode).toBe("chat");
  });

  it("supports scripted mockGenerator fixtures", () => {
    const scripted = mockGenerator({
      name: "agent-generator",
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
