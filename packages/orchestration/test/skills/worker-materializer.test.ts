import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSpec } from "@flow-state-dev/core";
import { __resetDeprecationWarningsForTests } from "@flow-state-dev/core";
import {
  materializeWorker,
  buildUserMessage,
  CONVERSATION_HISTORY_TURNS,
} from "../../src/skills/worker-materializer";
import type { WorkerMaterializationDeps } from "../../src/skills/worker-materializer";
import { skillFileKey } from "../../src/skills/collection";
import { createMockSkillsCollection } from "./mocks";

function deps(
  overrides: Partial<WorkerMaterializationDeps> = {},
): WorkerMaterializationDeps {
  const collection = createMockSkillsCollection();
  return {
    catalog: {},
    skillName: "demo",
    skillCollection: collection,
    defaultModelId: "openai/gpt-4o-mini",
    ...overrides,
  };
}

describe("materializeWorker — prompt-driven branches", () => {
  it("builds a generator from an inline prompt", async () => {
    const spec: AgentSpec = { prompt: "You are a market analyst." };
    const block = await materializeWorker("analyst", spec, deps());
    expect(block).toBeDefined();
    expect((block as { kind?: string }).kind).toBe("generator");
  });

  it("substitutes $ARGUMENTS in the inline prompt body", async () => {
    const spec: AgentSpec = { prompt: "Investigate $ARGUMENTS thoroughly." };
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
    const spec: AgentSpec = { promptRef: "reference/market.md" };
    const block = await materializeWorker(
      "analyst",
      spec,
      deps({ skillCollection: collection }),
    );
    const promptSlot = (block as { config?: { prompt?: unknown } }).config?.prompt;
    expect(JSON.stringify(promptSlot)).toContain("You are a market analyst.");
  });

  it("throws a clear error when prompt-ref points at a missing file", async () => {
    const spec: AgentSpec = { promptRef: "reference/nope.md" };
    await expect(materializeWorker("analyst", spec, deps())).rejects.toThrow(
      /prompt-ref 'reference\/nope\.md' not found/,
    );
  });

  it("warns + drops unknown tool keys, matches additive-not-restrictive policy", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const spec: AgentSpec = { prompt: "hi", tools: ["search", "ghost"] };
    await materializeWorker("a", spec, deps());
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown tool "ghost"'),
    );
    warn.mockRestore();
  });

  // FIX-965: the tool catalog is a plain object, so an inherited
  // `Object.prototype` member is truthy and can sail past a falsity-only
  // guard as if it were a real catalog hit.
  it.each(["constructor", "toString", "valueOf", "hasOwnProperty"])(
    "treats prototype-named tool key %j as unknown, not as a catalog hit",
    async (protoKey) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const spec: AgentSpec = { prompt: "hi", tools: [protoKey] };
      const block = await materializeWorker(
        "a",
        spec,
        deps({ catalog: { search: { config: { name: "search" } } as never } }),
      );
      // The point of the guard: an inherited `Object.prototype` member is
      // truthy, so a falsity-only check smuggles it into the generator's
      // `tools` array as if it were a real tool. Assert the resolved slot, not
      // just the warning — the warning alone would pass if the entry were both
      // warned about AND pushed.
      const tools = (block as { config?: { tools?: unknown[] } }).config?.tools;
      expect(tools).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(`unknown tool "${protoKey}"`),
      );
      warn.mockRestore();
    },
  );

  it("resolves model: per-worker → deps default → 'intent/chat' fallback", async () => {
    const collection = createMockSkillsCollection();

    // 1. Per-worker model wins.
    const withWorkerModel = await materializeWorker(
      "a",
      { prompt: "x", model: "anthropic/claude-haiku" },
      { catalog: {}, skillName: "demo", skillCollection: collection },
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
      { catalog: {}, skillName: "demo", skillCollection: collection },
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

describe("materializeWorker — contextSupply (FIX-920)", () => {
  // The history-visible warning dedupes per (skill, agent) key for the process
  // lifetime, so reset the shared warn-once ledger before each case.
  beforeEach(() => __resetDeprecationWarningsForTests());

  it("wires a bounded history slot for a conversation agent", async () => {
    // `conversation` inherits the parent conversation up to dispatch — but
    // bounded by default (epic FIX-930), using the real ItemQuery.limit shape
    // `{ limit: { turns: N } }`, NOT the full 50-turn window.
    const block = await materializeWorker(
      "summarizer",
      { prompt: "Summarize the discussion.", contextSupply: "conversation" },
      deps(),
    );
    const history = (block as { config?: { history?: unknown } }).config?.history;
    expect(history).toEqual({ limit: { turns: CONVERSATION_HISTORY_TURNS } });
  });

  it("rejects context-supply \"isolated\" — there is no sentinel; omit for the default", async () => {
    // The public surface is `contextSupply?: "conversation"`. Isolation is the
    // default, expressed by omitting the field, so a leftover `"isolated"` value
    // must fail loud rather than silently no-op.
    await expect(
      materializeWorker(
        "summarizer",
        { prompt: "x", contextSupply: "isolated" as unknown as "conversation" },
        deps(),
      ),
    ).rejects.toThrow(/context-supply/i);
  });

  it("sets no history slot when contextSupply is absent (default isolated)", async () => {
    const block = await materializeWorker("summarizer", { prompt: "x" }, deps());
    expect((block as { config?: { history?: unknown } }).config?.history).toBeUndefined();
  });

  it("keeps output itemVisibility history:false regardless of contextSupply", async () => {
    // Input inheritance and output isolation are independent axes — a
    // conversation agent still keeps its own steps out of host history.
    const conv = await materializeWorker(
      "a",
      { prompt: "x", contextSupply: "conversation" },
      deps(),
    );
    expect(
      (conv as { config?: { itemVisibility?: { client: boolean; history: boolean } } }).config
        ?.itemVisibility,
    ).toEqual({ client: true, history: false });
    const iso = await materializeWorker(
      "b",
      { prompt: "x" }, // absent contextSupply = isolated (the default)
      deps(),
    );
    expect(
      (iso as { config?: { itemVisibility?: { client: boolean; history: boolean } } }).config
        ?.itemVisibility,
    ).toEqual({ client: true, history: false });
  });

  it("rejects contextSupply on an agent-ref agent (parser-bypassed spec)", async () => {
    // The materializer is the authoritative guard: programmatic/persisted specs
    // skip parseAgentSpec, so the agentRef rejection must live here too.
    await expect(
      materializeWorker(
        "vet",
        { agentRef: "research-veteran", contextSupply: "conversation" } as AgentSpec,
        deps(),
      ),
    ).rejects.toThrow(/context-supply.*prompt\/prompt-ref|agent-ref agents own their own context/i);
  });

  it("rejects an out-of-enum contextSupply value rather than silently running isolated", async () => {
    await expect(
      materializeWorker(
        "a",
        { prompt: "x", contextSupply: "converstaion" as unknown as "conversation" },
        deps(),
      ),
    ).rejects.toThrow(/context-supply/i);
  });

  it("warns when a conversation agent also declares history-visible output", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await materializeWorker(
      "a",
      {
        prompt: "x",
        contextSupply: "conversation",
        itemVisibility: { client: true, history: true },
      },
      deps(),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no longer isolated"));
    warn.mockRestore();
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

describe("buildUserMessage", () => {
  it("renders the addTask input payload so it reaches the worker's turn", () => {
    // The addTask tool advertises `input` as "handed to the worker"; a skill
    // that plans `addTask({ goal, input: { subject } })` must actually see it.
    const msg = buildUserMessage({
      taskId: "t1",
      goal: "Research the company",
      input: { subject: "ACME Corp", depth: "deep" },
      attempts: 0,
    } as never);
    expect(msg).toContain("Task: Research the company");
    expect(msg).toContain("Input:");
    expect(msg).toContain("ACME Corp");
    expect(msg).toContain("deep");
  });

  it("renders a string input inline without JSON wrapping", () => {
    const msg = buildUserMessage({
      taskId: "t1",
      goal: "g",
      input: "just a string",
      attempts: 0,
    } as never);
    expect(msg).toContain("Input: just a string");
  });

  it("omits the input line when no payload was attached", () => {
    const msg = buildUserMessage({ taskId: "t1", goal: "g", attempts: 0 } as never);
    expect(msg).not.toContain("Input:");
  });
});
