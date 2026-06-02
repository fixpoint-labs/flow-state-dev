import { describe, it, expect, vi } from "vitest";
import { materializeAgent } from "../src/materialize-agent";
import { defineAgent } from "../src/define-agent";
import type { Agent, MaterializeAgentOptions } from "@flow-state-dev/core";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return defineAgent({
    name: "test-agent",
    description: "A test agent",
    persona: "You are a test agent.",
    ...overrides,
  });
}

function makeOpts(overrides: Partial<MaterializeAgentOptions> = {}): MaterializeAgentOptions {
  return {
    catalog: {},
    shape: "worker",
    workerKey: "w1",
    skillName: "test-skill",
    ...overrides,
  };
}

function inspectGenerator(block: any) {
  return block.__config ?? block._config ?? block.config ?? block;
}

describe("materializeAgent", () => {
  describe("worker shape", () => {
    it("produces a block with kind 'generator'", () => {
      const block = materializeAgent(makeAgent(), makeOpts()) as any;
      expect(block.kind).toBe("generator");
    });

    it("sets agentName from the agent's name", () => {
      const block = materializeAgent(makeAgent({ name: "my-agent" }), makeOpts()) as any;
      const config = inspectGenerator(block);
      expect(config.agentName).toBe("my-agent");
    });

    it("names the block using skillName and workerKey", () => {
      const block = materializeAgent(
        makeAgent(),
        makeOpts({ skillName: "research", workerKey: "analyst" }),
      ) as any;
      const config = inspectGenerator(block);
      expect(config.name).toBe("skillWorker_research_analyst");
    });

    it("uses worker inputSchema", () => {
      const block = materializeAgent(makeAgent(), makeOpts()) as any;
      const config = inspectGenerator(block);
      const shape = config.inputSchema.shape;
      expect(shape).toHaveProperty("taskId");
      expect(shape).toHaveProperty("goal");
      expect(shape).toHaveProperty("attempts");
    });

    it("outputs z.string()", () => {
      const block = materializeAgent(makeAgent(), makeOpts()) as any;
      const config = inspectGenerator(block);
      expect(config.outputSchema._def.typeName).toBe("ZodString");
    });
  });

  describe("standalone shape", () => {
    it("produces a block with kind 'generator'", () => {
      const block = materializeAgent(makeAgent(), makeOpts({ shape: "standalone" })) as any;
      expect(block.kind).toBe("generator");
    });

    it("names the block using agent name", () => {
      const block = materializeAgent(
        makeAgent({ name: "research-analyst" }),
        makeOpts({ shape: "standalone" }),
      ) as any;
      const config = inspectGenerator(block);
      expect(config.name).toBe("agent_research-analyst");
    });

    it("uses standalone inputSchema with goal field", () => {
      const block = materializeAgent(makeAgent(), makeOpts({ shape: "standalone" })) as any;
      const config = inspectGenerator(block);
      const shape = config.inputSchema.shape;
      expect(shape).toHaveProperty("goal");
      expect(shape).not.toHaveProperty("taskId");
    });
  });

  describe("override precedence (REPLACE semantics)", () => {
    it("overrides.model wins over agent.model", () => {
      const block = materializeAgent(
        makeAgent({ model: "agent-model" }),
        makeOpts({ overrides: { model: "override-model" } }),
      ) as any;
      expect(inspectGenerator(block).model).toBe("override-model");
    });

    it("agent.model wins over defaultModelId", () => {
      const block = materializeAgent(
        makeAgent({ model: "agent-model" }),
        makeOpts({ defaultModelId: "default-model" }),
      ) as any;
      expect(inspectGenerator(block).model).toBe("agent-model");
    });

    it("defaultModelId wins over intent/chat fallback", () => {
      const block = materializeAgent(
        makeAgent(),
        makeOpts({ defaultModelId: "default-model" }),
      ) as any;
      expect(inspectGenerator(block).model).toBe("default-model");
    });

    it("falls back to intent/chat when nothing is set", () => {
      const block = materializeAgent(makeAgent(), makeOpts()) as any;
      expect(inspectGenerator(block).model).toBe("intent/chat");
    });

    it("overrides.itemVisibility REPLACES agent.itemVisibility", () => {
      const block = materializeAgent(
        makeAgent({ itemVisibility: { client: false, history: true } }),
        makeOpts({
          overrides: { itemVisibility: { client: true, history: true } },
        }),
      ) as any;
      expect(inspectGenerator(block).itemVisibility).toEqual({
        client: true,
        history: true,
      });
    });

    it("defaults itemVisibility to { client: true, history: false }", () => {
      const block = materializeAgent(makeAgent(), makeOpts()) as any;
      expect(inspectGenerator(block).itemVisibility).toEqual({
        client: true,
        history: false,
      });
    });

    it("overrides.tools REPLACES agent.allowedTools wholesale", () => {
      const toolA = { name: "a", description: "a", inputSchema: {} as any, execute: async () => ({}) };
      const toolB = { name: "b", description: "b", inputSchema: {} as any, execute: async () => ({}) };
      const block = materializeAgent(
        makeAgent({ allowedTools: ["a"] }),
        makeOpts({
          catalog: { a: toolA, b: toolB },
          overrides: { tools: ["b"] },
        }),
      ) as any;
      const config = inspectGenerator(block);
      const toolNames = (config.tools ?? []).map((t: any) => t.name);
      expect(toolNames).toEqual(["b"]);
      expect(toolNames).not.toContain("a");
    });
  });

  describe("catalog resolution", () => {
    it("warns and skips unknown tool keys", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      materializeAgent(
        makeAgent({ allowedTools: ["nonexistent"] }),
        makeOpts(),
      );
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('unknown tool "nonexistent"'),
      );
      spy.mockRestore();
    });

    it("warns and skips unknown capability keys", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      materializeAgent(
        makeAgent({ usesCapabilities: ["nonexistent"] }),
        makeOpts({ capabilityCatalog: {} }),
      );
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('unknown capability "nonexistent"'),
      );
      spy.mockRestore();
    });

    it("warns when usesSkills is non-empty", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      materializeAgent(
        makeAgent({ usesSkills: ["some-skill"] }),
        makeOpts(),
      );
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining("usesSkills is reserved"),
      );
      spy.mockRestore();
    });
  });

  describe("provenance", () => {
    it("agentName is set from the agent's name, not from input", () => {
      const block = materializeAgent(
        makeAgent({ name: "trusted-name" }),
        makeOpts(),
      ) as any;
      expect(inspectGenerator(block).agentName).toBe("trusted-name");
    });
  });

  describe("worker shape validation", () => {
    it("throws when worker shape is missing skillName", () => {
      expect(() =>
        materializeAgent(makeAgent(), makeOpts({ skillName: undefined })),
      ).toThrow("worker shape requires skillName");
    });

    it("throws when worker shape is missing workerKey", () => {
      expect(() =>
        materializeAgent(makeAgent(), makeOpts({ workerKey: undefined })),
      ).toThrow("worker shape requires workerKey");
    });

    it("does not throw for standalone shape without skillName/workerKey", () => {
      expect(() =>
        materializeAgent(
          makeAgent(),
          makeOpts({ shape: "standalone", skillName: undefined, workerKey: undefined }),
        ),
      ).not.toThrow();
    });
  });
});
