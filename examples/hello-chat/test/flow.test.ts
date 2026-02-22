import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mockGenerator, testBlock } from "@flow-state-dev/testing";
import helloChatFlow from "../src/flows/hello-chat/flow";

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
      structuredOutput: {
        reply: "TypeScript is a typed superset of JavaScript.",
        model: "gpt-4o-mini"
      }
    }
  ]
});

describe("hello-chat", () => {
  it("completes a chat action", async () => {
    const result = await testBlock(chatPipeline, {
      input: { message: "What is TypeScript?" },
      generators: { "chat-generator": chatFixture }
    });

    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  it("emits fsd:block_output items", async () => {
    chatFixture.reset();
    const result = await testBlock(chatPipeline, {
      input: { message: "Hello" },
      generators: { "chat-generator": chatFixture }
    });

    const blockOutputs = result.items.filter((item) => item.type === "fsd:block_output");
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
