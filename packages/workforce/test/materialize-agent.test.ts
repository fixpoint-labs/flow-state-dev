import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { materializeAgent } from "../src/materialize-agent";
import { defineAgent } from "../src/define-agent";
import { defineCapability } from "@flow-state-dev/core";
import type { Agent, MaterializeAgentOptions } from "@flow-state-dev/core";
import { taskTools as taskToolsSingleton } from "@flow-state-dev/orchestration";

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

    // FIX-965: both catalogs are plain objects, so an inherited
    // `Object.prototype` member ("constructor", "toString", …) is truthy and
    // sails past a falsity-only guard — landing a non-tool / non-capability in
    // the generator's `tools` / `uses` slot. Assert the resolved slots, not
    // just the warning: a warning-only assertion passes even if the entry is
    // also pushed.
    it.each(["constructor", "toString", "valueOf", "hasOwnProperty"])(
      "treats prototype-named tool key %j as unknown",
      (protoKey) => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const block = materializeAgent(
          makeAgent({ allowedTools: [protoKey] }),
          makeOpts(),
        ) as any;
        expect(inspectGenerator(block).tools).toBeUndefined();
        expect(spy).toHaveBeenCalledWith(
          expect.stringContaining(`unknown tool "${protoKey}"`),
        );
        spy.mockRestore();
      },
    );

    it.each(["constructor", "toString", "valueOf", "hasOwnProperty"])(
      "treats prototype-named capability key %j as unknown",
      (protoKey) => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const block = materializeAgent(
          makeAgent({ usesCapabilities: [protoKey] }),
          makeOpts({ capabilityCatalog: {} }),
        ) as any;
        expect(inspectGenerator(block).uses).toBeUndefined();
        expect(spy).toHaveBeenCalledWith(
          expect.stringContaining(`unknown capability "${protoKey}"`),
        );
        spy.mockRestore();
      },
    );

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

  describe("structured output (FIX-732)", () => {
    const structured = z.object({ rating: z.string(), score: z.number() });

    it("standalone honors a declared structured outputSchema", () => {
      const block = materializeAgent(
        makeAgent({ outputSchema: structured }),
        makeOpts({ shape: "standalone" }),
      ) as any;
      const config = inspectGenerator(block);
      expect(config.outputSchema._def.typeName).toBe("ZodObject");
      expect(config.outputSchema.shape).toHaveProperty("rating");
    });

    it("workers ignore outputSchema and stay z.string()", () => {
      const block = materializeAgent(
        makeAgent({ outputSchema: structured }),
        makeOpts(), // worker shape
      ) as any;
      expect(inspectGenerator(block).outputSchema._def.typeName).toBe("ZodString");
    });

    it("standalone with no outputSchema defaults to z.string()", () => {
      const block = materializeAgent(
        makeAgent(),
        makeOpts({ shape: "standalone" }),
      ) as any;
      expect(inspectGenerator(block).outputSchema._def.typeName).toBe("ZodString");
    });
  });

  describe("capability refs (FIX-732)", () => {
    it("passes a .presets()-configured capability ref through to uses (no catalog needed)", () => {
      const cap = defineCapability({ name: "testCap", presets: { a: {} } });
      const configured = cap.presets({ a: true });
      const block = materializeAgent(
        makeAgent({ usesCapabilities: [configured] }),
        makeOpts({ shape: "standalone" }),
      ) as any;
      // The configured ref passes through unchanged (observable contract — no
      // coupling to how the capability factory stores its preset overrides).
      expect(inspectGenerator(block).uses ?? []).toContain(configured);
    });

    it("skips a string key silently when no capabilityCatalog is provided (backward-compat)", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const block = materializeAgent(
        makeAgent({ usesCapabilities: ["k"] }),
        makeOpts({ shape: "standalone" }), // no capabilityCatalog
      ) as any;
      expect(inspectGenerator(block).uses ?? []).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("still resolves a string key against the capabilityCatalog", () => {
      const cap = defineCapability({ name: "catCap" });
      const block = materializeAgent(
        makeAgent({ usesCapabilities: ["k"] }),
        makeOpts({ shape: "standalone", capabilityCatalog: { k: cap } }),
      ) as any;
      const names = (inspectGenerator(block).uses ?? []).map((u: any) => u?.name);
      expect(names).toContain("catCap");
    });

    it("resolves a mix of string keys and capability refs", () => {
      const keyed = defineCapability({ name: "keyedCap" });
      const ref = defineCapability({ name: "refCap", presets: { a: {} } });
      const block = materializeAgent(
        makeAgent({ usesCapabilities: ["k", ref.presets({ a: true })] }),
        makeOpts({ shape: "standalone", capabilityCatalog: { k: keyed } }),
      ) as any;
      const names = (inspectGenerator(block).uses ?? []).map((u: any) => u?.name);
      expect(names).toContain("keyedCap");
      expect(names).toContain("refCap");
    });
  });

  describe("board-scoped taskTools (FIX-927)", () => {
    it("prefers opts.boardTaskTools over the singleton for a taskTools worker", () => {
      // Distinct sentinel — createTaskToolsCapability/defineCapability return a
      // fresh object, so identity (`!==` singleton) is the observable contract.
      const boardTaskTools = defineCapability({ name: "boardTaskTools" });
      const block = materializeAgent(
        makeAgent({ allowedTools: ["taskTools"] }),
        makeOpts({ boardTaskTools }),
      ) as any;
      const uses = inspectGenerator(block).uses ?? [];
      expect(uses).toContain(boardTaskTools);
      expect(uses).not.toContain(taskToolsSingleton);
    });

    it("falls back to the singleton when no boardTaskTools is supplied", () => {
      const block = materializeAgent(
        makeAgent({ allowedTools: ["taskTools"] }),
        makeOpts(),
      ) as any;
      const uses = inspectGenerator(block).uses ?? [];
      expect(uses).toContain(taskToolsSingleton);
    });

    it("adds no taskTools capability when the agent does not declare taskTools", () => {
      const boardTaskTools = defineCapability({ name: "boardTaskTools" });
      const block = materializeAgent(
        makeAgent(), // no allowedTools
        makeOpts({ boardTaskTools }),
      ) as any;
      const uses = inspectGenerator(block).uses ?? [];
      expect(uses).not.toContain(boardTaskTools);
      expect(uses).not.toContain(taskToolsSingleton);
    });

    it("warns when a worker declares taskTools but no boardTaskTools was supplied, regardless of env", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const originalNodeEnv = process.env.NODE_ENV;
      // Matches the two other warns in this function (usesSkills, contextMode
      // "fork"): unconditional, not dev-only — the misconfiguration is worth
      // surfacing in production too.
      process.env.NODE_ENV = "production";
      try {
        materializeAgent(makeAgent({ allowedTools: ["taskTools"] }), makeOpts());
        expect(spy).toHaveBeenCalledWith(
          expect.stringContaining("boardTaskTools was supplied"),
        );
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        spy.mockRestore();
      }
    });

    it("does not warn for a standalone taskTools agent (no board is legitimate)", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      materializeAgent(
        makeAgent({ allowedTools: ["taskTools"] }),
        makeOpts({ shape: "standalone", skillName: undefined, workerKey: undefined }),
      );
      expect(spy).not.toHaveBeenCalledWith(
        expect.stringContaining("boardTaskTools was supplied"),
      );
      spy.mockRestore();
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
