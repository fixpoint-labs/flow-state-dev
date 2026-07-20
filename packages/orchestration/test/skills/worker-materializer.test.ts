import { describe, expect, it, vi } from "vitest";
import type { WorkerSpec } from "@flow-state-dev/core";
import { materializeWorker } from "../../src/skills/worker-materializer";
import type { PatternRegistryDeps } from "../../src/skills/pattern-registry";
import { skillFileKey } from "../../src/skills/collection";
import { createMockSkillsCollection } from "./mocks";

function deps(overrides: Partial<PatternRegistryDeps> = {}): PatternRegistryDeps {
  const collection = createMockSkillsCollection();
  return {
    catalog: {},
    skillName: "demo",
    skillCollection: collection,
    defaultModelId: "openai/gpt-4o-mini",
    collectionId: "skill_demo_r1_1",
    ...overrides,
  };
}

describe("materializeWorker — prompt-driven branches", () => {
  it("builds a generator from an inline prompt", async () => {
    const spec: WorkerSpec = { prompt: "You are a market analyst." };
    const block = await materializeWorker("analyst", spec, deps());
    expect(block).toBeDefined();
    expect((block as { kind?: string }).kind).toBe("generator");
  });

  it("substitutes $ARGUMENTS in the inline prompt body", async () => {
    const spec: WorkerSpec = { prompt: "Investigate $ARGUMENTS thoroughly." };
    const d = deps({ input: "ACME Corp" });
    const block = await materializeWorker("analyst", spec, d);
    // The generator stores the prompt as a static string. Reach in to verify
    // the substitution happened.
    const promptSlot = (block as { config?: { prompt?: unknown } }).config?.prompt;
    expect(JSON.stringify(promptSlot)).toContain("ACME Corp");
  });

  it("reads prompt-ref content from the skill collection and strips frontmatter", async () => {
    const collection = createMockSkillsCollection();
    await collection.create(skillFileKey("demo", "reference/market.md"), {});
    const ref = collection.getOptional(skillFileKey("demo", "reference/market.md"));
    await (ref as unknown as { writeContent: (s: string) => Promise<void> }).writeContent(
      "---\ndescription: scratch\n---\n\nYou are a market analyst.",
    );
    const spec: WorkerSpec = { promptRef: "reference/market.md" };
    const block = await materializeWorker(
      "analyst",
      spec,
      deps({ skillCollection: collection }),
    );
    const promptSlot = (block as { config?: { prompt?: unknown } }).config?.prompt;
    expect(JSON.stringify(promptSlot)).toContain("You are a market analyst.");
  });

  it("throws a clear error when prompt-ref points at a missing file", async () => {
    const spec: WorkerSpec = { promptRef: "reference/nope.md" };
    await expect(materializeWorker("analyst", spec, deps())).rejects.toThrow(
      /prompt-ref 'reference\/nope\.md' not found/,
    );
  });

  it("warns + drops unknown tool keys, matches additive-not-restrictive policy", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const spec: WorkerSpec = { prompt: "hi", tools: ["search", "ghost"] };
    await materializeWorker("a", spec, deps());
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown tool "ghost"'),
    );
    warn.mockRestore();
  });

  it("resolves model: per-worker → deps default → 'intent/chat' fallback", async () => {
    const collection = createMockSkillsCollection();

    // 1. Per-worker model wins.
    const withWorkerModel = await materializeWorker(
      "a",
      { prompt: "x", model: "anthropic/claude-haiku" },
      { catalog: {}, skillName: "demo", skillCollection: collection, collectionId: "skill_demo_r1_1" },
    );
    expect((withWorkerModel as { config?: { model?: string } }).config?.model).toBe(
      "anthropic/claude-haiku",
    );

    // 2. Falls back to deps.defaultModelId.
    const withDepsDefault = await materializeWorker(
      "b",
      { prompt: "x" },
      {
        catalog: {},
        skillName: "demo",
        skillCollection: collection,
        defaultModelId: "openai/gpt-4o-mini",
        collectionId: "skill_demo_r1_1",
      },
    );
    expect((withDepsDefault as { config?: { model?: string } }).config?.model).toBe(
      "openai/gpt-4o-mini",
    );

    // 3. Final fallback to 'intent/chat' — no per-worker model, no deps default.
    //    This is the kitchen-sink default-skills-capability scenario.
    const fallback = await materializeWorker(
      "c",
      { prompt: "x" },
      { catalog: {}, skillName: "demo", skillCollection: collection, collectionId: "skill_demo_r1_1" },
    );
    expect((fallback as { config?: { model?: string } }).config?.model).toBe("intent/chat");
  });

  it("defaults itemVisibility to sub-equivalent and propagates spec.itemVisibility", async () => {
    const sub = await materializeWorker("a", { prompt: "x" }, deps());
    expect((sub as { config?: { itemVisibility?: { client: boolean; history: boolean } } }).config?.itemVisibility).toEqual(
      { client: true, history: false },
    );
    const primary = await materializeWorker(
      "b",
      { prompt: "x", itemVisibility: { client: true, history: true } },
      deps(),
    );
    expect((primary as { config?: { itemVisibility?: { client: boolean; history: boolean } } }).config?.itemVisibility).toEqual(
      { client: true, history: true },
    );
  });

  it("routes 'taskTools' in spec.tools through capability composition", async () => {
    const block = await materializeWorker(
      "discoverer",
      { prompt: "find competitors", tools: ["taskTools"] },
      deps(),
    );
    const cfg = (block as { config?: { uses?: readonly { name?: string }[] } }).config;
    expect(cfg?.uses).toBeDefined();
    expect(cfg?.uses?.[0]?.name).toBe("taskTools");
  });

  it("omits the uses slot when taskTools is not requested", async () => {
    const block = await materializeWorker(
      "analyst",
      { prompt: "analyze", tools: ["search"] },
      deps({ catalog: { search: { config: { name: "search" } } as never } }),
    );
    const cfg = (block as { config?: { uses?: unknown } }).config;
    expect(cfg?.uses).toBeUndefined();
  });
});

describe("materializeWorker — block-ref branch", () => {
  it("returns the registered block when block-ref matches", async () => {
    const blockDef = { kind: "handler", name: "custom" } as never;
    const block = await materializeWorker(
      "vet",
      { blockRef: "custom" },
      deps({ blocks: { custom: blockDef } }),
    );
    expect(block).toBe(blockDef);
  });

  it("throws naming the unknown key when block-ref misses", async () => {
    await expect(
      materializeWorker("vet", { blockRef: "ghost" }, deps()),
    ).rejects.toThrow(/block-ref 'ghost' not found/);
  });
});

describe("materializeWorker — agent-ref stub", () => {
  it("throws \"no agentRegistry\" when none was supplied", async () => {
    await expect(
      materializeWorker("vet", { agentRef: "research-veteran" }, deps()),
    ).rejects.toThrow(/no \s*agentRegistry was supplied|no agentRegistry was supplied/i);
  });

  it("throws \"no materializeAgent\" when registry is supplied but materializer is not", async () => {
    const mockRegistry = {
      get: vi.fn(),
      list: vi.fn(),
    } as never;
    await expect(
      materializeWorker(
        "vet",
        { agentRef: "research-veteran" },
        deps({ agentRegistry: mockRegistry }),
      ),
    ).rejects.toThrow(/no materializeAgent function was supplied/);
  });

  it("throws naming registered agents when agent is not found", async () => {
    const mockRegistry = {
      get: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([{ name: "other-agent" }]),
    } as never;
    const mockMaterialize = vi.fn();
    await expect(
      materializeWorker(
        "vet",
        { agentRef: "research-veteran" },
        deps({ agentRegistry: mockRegistry, materializeAgent: mockMaterialize as any }),
      ),
    ).rejects.toThrow(/not in the registry.*other-agent/);
  });

  it("calls materializeAgent when agent-ref resolves", async () => {
    const agent = { name: "research-veteran", description: "d", persona: "p" };
    const mockRegistry = {
      get: vi.fn().mockResolvedValue(agent),
      list: vi.fn().mockResolvedValue([agent]),
    } as never;
    const fakeBlock = { kind: "generator" as const, config: {} } as any;
    const mockMaterialize = vi.fn().mockReturnValue(fakeBlock);
    const result = await materializeWorker(
      "vet",
      { agentRef: "research-veteran", agentOverrides: { model: "fast" } },
      deps({ agentRegistry: mockRegistry, materializeAgent: mockMaterialize as any }),
    );
    expect(result).toBe(fakeBlock);
    expect(mockMaterialize).toHaveBeenCalledWith(agent, expect.objectContaining({
      shape: "worker",
      workerKey: "vet",
      overrides: { model: "fast" },
    }));
  });
});
