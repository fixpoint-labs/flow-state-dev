import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mockGenerator, testBlock, testFlow } from "@flow-state-dev/testing";
import helloChatFlow from "../src/flows/hello-chat/flow";

/**
 * These tests intentionally mock generator output with @flow-state-dev/testing.
 * They should never require OPENAI_API_KEY or make real network calls.
 */

// Access the pipeline block from the flow definition for state-change assertions.
// testFlow exercises the runtime path, while testBlock exposes state mutations.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chatPipeline = (helloChatFlow.actions.chat as any).block;
const MODEL_ID = "preset/fast";

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

function createChatFixture() {
  return mockGenerator({
    name: "chat-generator",
    script: Array.from({ length: 6 }, () => ({
      text: "TypeScript is a typed superset of JavaScript."
    }))
  });
}

function withGeneratorMocks(chatFixture: ReturnType<typeof createChatFixture>) {
  return {
    generators: { "chat-generator": chatFixture },
    models: { [MODEL_ID]: chatFixture }
  };
}

describe("hello-chat", () => {
  beforeAll(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      throw new Error(
        `Unexpected network request in mocked hello-chat tests: ${String(input)}`
      );
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("completes a chat action", async () => {
    const chatFixture = createChatFixture();
    const result = await testFlow({
      flow: helloChatFlow,
      action: "chat",
      userId: "test-user",
      input: { message: "What is TypeScript?" },
      ...withGeneratorMocks(chatFixture)
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    expect(result.output).toBeDefined();
  });

  it("emits block_trace items", async () => {
    const chatFixture = createChatFixture();
    const result = await testFlow({
      flow: helloChatFlow,
      action: "chat",
      userId: "test-user",
      input: { message: "Hello" },
      ...withGeneratorMocks(chatFixture)
    });

    const blockOutputs = result.items.filter((item) => item.type === "block_trace");
    expect(blockOutputs.length).toBeGreaterThan(0);
  });

  it("increments message count in session state", async () => {
    const chatFixture = createChatFixture();
    const result = await testBlock(chatPipeline, {
      input: { message: "Hello again" },
      session: {
        state: { messageCount: 5 }
      },
      ...withGeneratorMocks(chatFixture)
    });

    expect(result.error).toBeNull();
    const patchOp = result.stateChanges.find(
      (change) => change.scope === "session" && change.operation === "patchState"
    );
    expect(patchOp).toBeDefined();
    expect(patchOp?.resultingState.messageCount).toBe(6);
  });

  it("contains no legacy terminology in source", () => {
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
