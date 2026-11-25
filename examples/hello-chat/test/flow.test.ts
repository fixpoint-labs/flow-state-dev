import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import helloChatFlow from "../src/flows/hello-chat/flow";

/**
 * These tests intentionally mock generator output with @flow-state-dev/testing.
 * They should never require OPENAI_API_KEY or make real network calls.
 */

const MODEL_ID = "openai/gpt-5.4-mini";

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

  it("counts each completed exchange when two requests overlap", async () => {
    const stores = createInMemoryStores();
    const sessionId = "shared-chat";
    const chatFixture = createChatFixture();
    const chat = (message: string) => testFlow({
      flow: helloChatFlow,
      action: "chat",
      userId: "test-user",
      sessionId,
      stores,
      input: { message },
      ...withGeneratorMocks(chatFixture)
    });

    const first = await chat("Hello");
    expect(first.output).toBe("TypeScript is a typed superset of JavaScript.");
    expect((await stores.session.get(sessionId))?.state.messageCount).toBe(1);

    const replies = await Promise.all([chat("First follow-up"), chat("Second follow-up")]);
    expect(replies.map((reply) => reply.status)).toEqual(["completed", "completed"]);
    expect((await stores.session.get(sessionId))?.state.messageCount).toBe(3);
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
