import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, generator, handler, sequencer } from "../src";
import { defineResource } from "../src/types/resource";
import { createMockContext } from "./helpers";

describe("defineFlow", () => {
  it("returns callable flow type with defaults and merge-based overrides", () => {
    const baseAction = handler({
      name: "base-action",
      inputSchema: z.object({ value: z.number() }),
      execute: (input) => input.value + 1
    });

    const flow = defineFlow({
      kind: "demo",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: baseAction
        }
      },
      session: {
        stateSchema: z.object({ mode: z.enum(["plan", "edit"]) })
      }
    });

    const custom = flow({
      id: "demo-custom",
      kind: "demo-custom-kind",
      actions: {
        extra: {
          inputSchema: z.object({ message: z.string() }),
          block: handler({
            name: "extra-action",
            inputSchema: z.object({ message: z.string() }),
            execute: (input) => input.message
          })
        }
      },
      session: {
        metadata: z.object({ traceId: z.string() })
      }
    });

    expect(flow.kind).toBe("demo");
    expect(flow.requireUser).toBe(true);

    expect(custom.id).toBe("demo-custom");
    expect(custom.kind).toBe("demo-custom-kind");
    expect(custom.requireUser).toBe(true);
    expect(Object.keys(custom.actions).sort()).toEqual(["extra", "run"]);
    expect(custom.session?.stateSchema).toBeDefined();
    expect(custom.session?.metadata).toBeDefined();
  });

  it("enforces requireUser phase policy at definition and instance creation", () => {
    expect(() =>
      defineFlow({
        kind: "invalid",
        requireUser: false,
        actions: {
          run: {
            inputSchema: z.object({}),
            block: handler({
              name: "noop",
              execute: () => ({})
            })
          }
        }
      })
    ).toThrow("requireUser=true");

    const flow = defineFlow({
      kind: "valid",
      actions: {
        run: {
          inputSchema: z.object({}),
          block: handler({
            name: "noop-valid",
            execute: () => ({})
          })
        }
      }
    });

    expect(() => flow({ requireUser: false })).toThrow("requireUser=true");
  });

  it("wires flow-level tool defaults and lifecycle hooks into generator execution", async () => {
    // Tools are compiled with `execute` wrappers that include retry and
    // lifecycle hooks. The mock model simulates the AI SDK calling execute.
    let attempts = 0;
    const onToolStarted = vi.fn();
    const onToolCompleted = vi.fn();
    const onToolErrored = vi.fn();
    const flakyTool = handler({
      name: "flaky-tool",
      execute: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("flaky");
        }

        return { ok: true };
      }
    });

    const runAction = generator({
      name: "run-generator",
      model: "test-model",
      prompt: "test-prompt",
      outputSchema: z.object({ ok: z.boolean() }),
      tools: [flakyTool]
    });

    const flow = defineFlow({
      kind: "tools-demo",
      actions: {
        run: {
          inputSchema: z.object({ text: z.string() }),
          block: runAction
        }
      },
      tools: {
        defaults: {
          retry: {
            maxAttempts: 2,
            baseDelayMs: 0
          }
        },
        onToolStarted,
        onToolCompleted,
        onToolErrored
      }
    });

    const instance = flow();
    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "test-model",
        async generate(options: any) {
          // Simulate AI SDK: call tool execute, then return final result.
          // The execute wrapper includes retry (maxAttempts: 2).
          if (options.tools?.length > 0) {
            const tool = options.tools[0];
            if (tool.execute) {
              await tool.execute({ text: "hello" });
            }
          }
          return {
            structuredOutput: { ok: true }
          };
        }
      })
    });
    await expect(instance.actions.run.block.run({ text: "hello" }, ctx)).resolves.toEqual({
      ok: true
    });

    // flaky tool fails once then succeeds on retry
    expect(attempts).toBe(2);
    expect(onToolStarted).toHaveBeenCalledTimes(1);
    expect(onToolCompleted).toHaveBeenCalledTimes(1);
    expect(onToolErrored).not.toHaveBeenCalled();
  });

  it("allows instance tool hooks to override flow hooks", async () => {
    const baseStarted = vi.fn();
    const overrideStarted = vi.fn();
    const okTool = handler({
      name: "ok-tool",
      execute: () => ({ ok: true })
    });

    const runAction = generator({
      name: "override-hooks-generator",
      model: "model",
      prompt: "prompt",
      outputSchema: z.object({ ok: z.boolean() }),
      tools: [okTool]
    });

    const flow = defineFlow({
      kind: "hook-override",
      actions: {
        run: {
          inputSchema: z.object({ text: z.string() }),
          block: runAction
        }
      },
      tools: {
        onToolStarted: baseStarted
      }
    });

    const instance = flow({
      tools: {
        onToolStarted: overrideStarted
      }
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "model",
        async generate(options: any) {
          // Simulate AI SDK: call tool execute, then return final result.
          if (options.tools?.length > 0) {
            const tool = options.tools[0];
            if (tool.execute) {
              await tool.execute({ text: "hello" });
            }
          }
          return {
            structuredOutput: { ok: true }
          };
        }
      })
    });
    await expect(instance.actions.run.block.run({ text: "hello" }, ctx)).resolves.toEqual({
      ok: true
    });

    expect(baseStarted).not.toHaveBeenCalled();
    expect(overrideStarted).toHaveBeenCalledTimes(1);
  });

  describe("resource merging", () => {
    const observationsResource = defineResource({
      stateSchema: z.object({
        entries: z.array(z.object({ text: z.string(), score: z.number() }))
      })
    });

    const artifactsResource = defineResource({
      stateSchema: z.object({
        order: z.array(z.string()),
        byId: z.record(z.object({ title: z.string() }))
      })
    });

    const flowLevelResource = defineResource({
      stateSchema: z.object({ count: z.number() })
    });

    it("merges block-declared session resources into flow session config", () => {
      const block = handler({
        name: "with-resources",
        sessionResources: { observations: observationsResource },
        execute: (v) => v
      });

      const flow = defineFlow({
        kind: "res-merge",
        actions: {
          run: { inputSchema: z.any(), block }
        }
      });

      expect(flow.session?.resources).toEqual({
        observations: observationsResource
      });
    });

    it("merges block-declared user resources into flow user config", () => {
      const block = handler({
        name: "with-user-res",
        userResources: { artifacts: artifactsResource },
        execute: (v) => v
      });

      const flow = defineFlow({
        kind: "user-res",
        actions: {
          run: { inputSchema: z.any(), block }
        }
      });

      expect(flow.user?.resources).toEqual({
        artifacts: artifactsResource
      });
    });

    it("merges block-declared project resources into flow project config", () => {
      const block = handler({
        name: "with-proj-res",
        projectResources: { artifacts: artifactsResource },
        execute: (v) => v
      });

      const flow = defineFlow({
        kind: "proj-res",
        actions: {
          run: { inputSchema: z.any(), block }
        }
      });

      expect(flow.project?.resources).toEqual({
        artifacts: artifactsResource
      });
    });

    it("flow-level resources take priority over block-declared resources", () => {
      const block = handler({
        name: "block-obs",
        sessionResources: { observations: observationsResource },
        execute: (v) => v
      });

      const flow = defineFlow({
        kind: "flow-wins",
        actions: {
          run: { inputSchema: z.any(), block }
        },
        session: {
          resources: { observations: flowLevelResource }
        }
      });

      // Flow-level wins — should be the flowLevelResource, not observationsResource
      expect(flow.session?.resources?.observations).toBe(flowLevelResource);
    });

    it("merges disjoint flow-level and block-declared resources", () => {
      const block = handler({
        name: "block-obs",
        sessionResources: { observations: observationsResource },
        execute: (v) => v
      });

      const flow = defineFlow({
        kind: "disjoint",
        actions: {
          run: { inputSchema: z.any(), block }
        },
        session: {
          resources: { counter: flowLevelResource }
        }
      });

      expect(flow.session?.resources).toEqual({
        observations: observationsResource,
        counter: flowLevelResource
      });
    });

    it("merges resources from multiple actions", () => {
      const blockA = handler({
        name: "a",
        sessionResources: { observations: observationsResource },
        execute: (v) => v
      });
      const blockB = handler({
        name: "b",
        userResources: { artifacts: artifactsResource },
        execute: (v) => v
      });

      const flow = defineFlow({
        kind: "multi-action",
        actions: {
          run: { inputSchema: z.any(), block: blockA },
          other: { inputSchema: z.any(), block: blockB }
        }
      });

      expect(flow.session?.resources).toEqual({
        observations: observationsResource
      });
      expect(flow.user?.resources).toEqual({
        artifacts: artifactsResource
      });
    });

    it("collects resources from sequencer blocks (nested collection)", () => {
      const innerBlock = handler({
        name: "inner",
        sessionResources: { observations: observationsResource },
        execute: (v) => v
      });
      const seq = sequencer({ name: "pipeline" }).then(innerBlock);

      const flow = defineFlow({
        kind: "seq-res",
        actions: {
          run: { inputSchema: z.any(), block: seq }
        }
      });

      expect(flow.session?.resources).toEqual({
        observations: observationsResource
      });
    });

    it("preserves existing flow scope config when merging block resources", () => {
      const block = handler({
        name: "with-res",
        sessionResources: { observations: observationsResource },
        execute: (v) => v
      });

      const flow = defineFlow({
        kind: "preserve-config",
        actions: {
          run: { inputSchema: z.any(), block }
        },
        session: {
          stateSchema: z.object({ mode: z.string() })
        }
      });

      expect(flow.session?.stateSchema).toBeDefined();
      expect(flow.session?.resources).toEqual({
        observations: observationsResource
      });
    });

    it("does not modify scope configs when no block resources are declared", () => {
      const block = handler({
        name: "no-res",
        execute: (v) => v
      });

      const flow = defineFlow({
        kind: "no-block-res",
        actions: {
          run: { inputSchema: z.any(), block }
        }
      });

      expect(flow.session).toBeUndefined();
      expect(flow.user).toBeUndefined();
      expect(flow.project).toBeUndefined();
    });

    it("merges block resources into flow instances created via factory", () => {
      const block = handler({
        name: "with-res",
        sessionResources: { observations: observationsResource },
        execute: (v) => v
      });

      const flow = defineFlow({
        kind: "instance-merge",
        actions: {
          run: { inputSchema: z.any(), block }
        }
      });

      const instance = flow({ id: "test" });
      expect(instance.session?.resources).toEqual({
        observations: observationsResource
      });
    });
  });
});
