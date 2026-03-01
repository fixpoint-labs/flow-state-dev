import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mockGenerator, testBlock } from "@flow-state-dev/testing";
import helloChatFlow from "../src/flows/hello-chat/flow";

/**
 * These tests intentionally mock generator output with @flow-state-dev/testing.
 * They should never require OPENAI_API_KEY or make real network calls.
 */

// Access the pipeline block from the flow definition for unit testing.
// testBlock supports generator mocks; testFlow does not yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chatPipeline = (helloChatFlow.actions.chat as any).block;

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

const chatFixture = mockGenerator({
  name: "chat-generator",
  script: [
    {
      text: "TypeScript is a typed superset of JavaScript."
    }
  ]
});

let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;

describe("hello-chat", () => {
  beforeAll(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      throw new Error(
        `Unexpected network request in mocked hello-chat tests: ${String(input)}`
      );
    });
  });

  afterAll(() => {
    fetchSpy?.mockRestore();
  });

  it("completes a chat action", async () => {
    const result = await testBlock(chatPipeline, {
      input: { message: "What is TypeScript?" },
      generators: { "chat-generator": chatFixture }
    });

    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  it("emits block_output items", async () => {
    chatFixture.reset();
    const result = await testBlock(chatPipeline, {
      input: { message: "Hello" },
      generators: { "chat-generator": chatFixture }
    });

    const blockOutputs = result.items.filter((item) => item.type === "block_output");
    expect(blockOutputs.length).toBeGreaterThan(0);
  });

  it("increments message count in session state", async () => {
    chatFixture.reset();
    const result = await testBlock(chatPipeline, {
      input: { message: "Hello again" },
      session: {
        state: { messageCount: 5 }
      },
      generators: { "chat-generator": chatFixture }
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
