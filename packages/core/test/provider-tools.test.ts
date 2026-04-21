import { describe, expect, it } from "vitest";
import { providerTool, generator } from "../src";
import type { ProviderTool, GeneratorSearchConfig } from "../src/types/model";
import { createMockContext } from "./helpers";

describe("providerTool factory", () => {
  it("creates a ProviderTool with correct shape", () => {
    const rawTool = { type: "provider-defined", id: "web_search" };
    const pt = providerTool("webSearch", rawTool);

    expect(pt.__providerTool).toBe(true);
    expect(pt.name).toBe("webSearch");
    expect(pt.tool).toBe(rawTool);
  });

  it("preserves arbitrary tool objects without modification", () => {
    const complexTool = { nested: { config: { maxUses: 5 } }, fn: () => {} };
    const pt = providerTool("complex", complexTool);

    expect(pt.tool).toBe(complexTool);
  });
});

describe("generator search config", () => {
  it("resolves search: true to provider search tool when model supports it", async () => {
    const mockProviderTool = { type: "provider-defined", id: "web_search_mock" };
    let receivedProviderTools: ProviderTool[] | undefined;

    const block = generator({
      name: "search-gen",
      model: "test-model",
      prompt: "Search the web",
      search: true,
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "test-model",
        async generate(options) {
          receivedProviderTools = options.providerTools;
          return { text: "result" };
        },
        resolveSearchTool(_config: GeneratorSearchConfig) {
          return { name: "web_search", tool: mockProviderTool };
        }
      })
    });

    await block.run({}, ctx);
    expect(receivedProviderTools).toBeDefined();
    expect(receivedProviderTools).toHaveLength(1);
    expect(receivedProviderTools![0].name).toBe("web_search");
    expect(receivedProviderTools![0].tool).toBe(mockProviderTool);
  });

  it("passes normalized config to resolveSearchTool", async () => {
    let receivedConfig: GeneratorSearchConfig | undefined;

    const block = generator({
      name: "config-gen",
      model: "test-model",
      prompt: "Search",
      search: {
        maxUses: 3,
        allowedDomains: ["example.com"],
        searchDepth: "high"
      },
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "test-model",
        async generate() {
          return { text: "result" };
        },
        resolveSearchTool(config: GeneratorSearchConfig) {
          receivedConfig = config;
          return { name: "web_search", tool: {} };
        }
      })
    });

    await block.run({}, ctx);
    expect(receivedConfig).toEqual({
      maxUses: 3,
      allowedDomains: ["example.com"],
      searchDepth: "high"
    });
  });

  it("skips search when model does not implement resolveSearchTool", async () => {
    let receivedProviderTools: ProviderTool[] | undefined;

    const block = generator({
      name: "no-search-gen",
      model: "test-model",
      prompt: "Search",
      search: true,
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "test-model",
        async generate(options) {
          receivedProviderTools = options.providerTools;
          return { text: "result" };
        }
        // No resolveSearchTool
      })
    });

    await block.run({}, ctx);
    expect(receivedProviderTools).toBeUndefined();
  });

  it("merges search tool with explicit providerTools", async () => {
    const explicitTool = providerTool("codeExec", { type: "code_execution" });
    let receivedProviderTools: ProviderTool[] | undefined;

    const block = generator({
      name: "merged-gen",
      model: "test-model",
      prompt: "Do things",
      search: true,
      providerTools: [explicitTool],
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "test-model",
        async generate(options) {
          receivedProviderTools = options.providerTools;
          return { text: "result" };
        },
        resolveSearchTool() {
          return { name: "web_search", tool: { type: "search" } };
        }
      })
    });

    await block.run({}, ctx);
    expect(receivedProviderTools).toHaveLength(2);
    expect(receivedProviderTools![0].name).toBe("codeExec");
    expect(receivedProviderTools![1].name).toBe("web_search");
  });

  it("emits source items from non-streaming generation", async () => {
    const emittedEvents: Array<{ type: string; item?: any }> = [];

    const block = generator({
      name: "source-gen",
      agentType: "agent",
      model: "test-model",
      prompt: "Search",
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "test-model",
        async generate() {
          return {
            text: "result with sources",
            sources: [
              { type: "source" as const, sourceType: "url" as const, id: "src_1", url: "https://example.com", title: "Example" },
              { type: "source" as const, sourceType: "url" as const, id: "src_2", url: "https://test.com" }
            ]
          };
        }
      }),
      response: {
        emit: (event: any) => { emittedEvents.push(event); }
      }
    });

    await block.run({}, ctx);

    const sourceEvents = emittedEvents.filter(
      (e) => e.type === "item.added" && e.item?.type === "source"
    );
    expect(sourceEvents).toHaveLength(2);
    expect(sourceEvents[0].item.url).toBe("https://example.com");
    expect(sourceEvents[0].item.title).toBe("Example");
    expect(sourceEvents[1].item.url).toBe("https://test.com");
    expect(sourceEvents[1].item.title).toBeUndefined();
  });
});
