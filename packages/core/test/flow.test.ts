import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, generator, handler, sequencer } from "../src";
import { defineResource } from "../src/types/resource";
import { createMockContext, runForTest } from "./helpers";
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

  it("allows requireUser: false on flows with no user-scope declarations", () => {
    const flow = defineFlow({
      kind: "system-only",
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
    });

    expect(flow.requireUser).toBe(false);
    const instance = flow();
    expect(instance.requireUser).toBe(false);
  });

  it("authentication.requireUser overrides the top-level requireUser shorthand", () => {
    const flow = defineFlow({
      kind: "auth-overrides-top",
      requireUser: true,
      authentication: { requireUser: false },
      actions: {
        run: {
          inputSchema: z.object({}),
          block: handler({ name: "noop", execute: () => ({}) })
        }
      }
    });

    expect(flow.requireUser).toBe(false);
    expect(flow.authentication?.requireUser).toBe(false);
  });

  it("rejects requireUser: false when user.stateSchema is declared", () => {
    expect(() =>
      defineFlow({
        kind: "user-state-with-no-user",
        requireUser: false,
        user: { stateSchema: z.object({ pref: z.string() }) },
        actions: {
          run: {
            inputSchema: z.object({}),
            block: handler({ name: "noop", execute: () => ({}) })
          }
        }
      })
    ).toThrow(/requireUser: false/);
  });

  it("rejects requireUser: false when a user-scoped resource is declared at the flow level", () => {
    const userResource = defineResource({
      scope: "user",
      stateSchema: z.object({ count: z.number() })
    });
    expect(() =>
      defineFlow({
        kind: "user-resource-with-no-user",
        requireUser: false,
        actions: {
          run: {
            inputSchema: z.object({}),
            block: handler({ name: "noop", execute: () => ({}) })
          }
        },
        resources: { artifacts: userResource }
      })
    ).toThrow(/scope: "user"/);
  });

  it("rejects requireUser: false when a block declares a user-scoped resource", () => {
    const userResource = defineResource({
      scope: "user",
      stateSchema: z.object({ count: z.number() })
    });
    const block = handler({
      name: "with-user-res",
      resources: { artifacts: userResource },
      execute: (v: unknown) => v
    });
    expect(() =>
      defineFlow({
        kind: "block-user-res-with-no-user",
        requireUser: false,
        actions: {
          run: { inputSchema: z.any(), block }
        }
      })
    ).toThrow(/scope: "user"/);
  });

  it("rejects requireUser: false when user.client is declared", () => {
    // Legacy `clientData` normalizes into `client.derived`, so the
    // requireUser-consistency check applies to either input shape.
    expect(() =>
      defineFlow({
        kind: "user-clientdata-with-no-user",
        requireUser: false,
        user: {
          clientData: {
            displayName: () => "anon"
          }
        },
        actions: {
          run: {
            inputSchema: z.object({}),
            block: handler({ name: "noop", execute: () => ({}) })
          }
        }
      })
    ).toThrow(/user\.client/);
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
    await expect(runForTest(instance.actions.run.block, { text: "hello" }, ctx)).resolves.toEqual({
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
    await expect(runForTest(instance.actions.run.block, { text: "hello" }, ctx)).resolves.toEqual({
      ok: true
    });

    expect(baseStarted).not.toHaveBeenCalled();
    expect(overrideStarted).toHaveBeenCalledTimes(1);
  });

  describe("resource merging", () => {
    const observationsResource = defineResource({
      scope: "session",
      stateSchema: z.object({
        entries: z.array(z.object({ text: z.string(), score: z.number() }))
      })
    });

    const artifactsResource = defineResource({
      scope: "user",
      stateSchema: z.object({
        order: z.array(z.string()),
        byId: z.record(z.object({ title: z.string() }))
      })
    });

    const orgArtifactsResource = defineResource({
      scope: "org",
      stateSchema: z.object({
        order: z.array(z.string()),
        byId: z.record(z.object({ title: z.string() }))
      })
    });

    const flowLevelResource = defineResource({
      scope: "session",
      ref: "flow-counter",
      stateSchema: z.object({ count: z.number() })
    });

    it("bubbles block-declared session resources into the flat flow.resources map", () => {
      const block = handler({
        name: "with-resources",
        resources: { observations: observationsResource },
        execute: (v) => v
      });

      const flow = defineFlow({
        kind: "res-merge",
        actions: {
          run: { inputSchema: z.any(), block }
        }
      });

      expect(flow.resources).toEqual({
        observations: observationsResource
      });
    });

    it("bubbles block-declared user resources into the flat flow.resources map", () => {
      const block = handler({
        name: "with-user-res",
        resources: { artifacts: artifactsResource },
        execute: (v) => v
      });

      const flow = defineFlow({
        kind: "user-res",
        actions: {
          run: { inputSchema: z.any(), block }
        }
      });

      expect(flow.resources).toEqual({
        artifacts: artifactsResource
      });
    });

    it("bubbles block-declared org resources into the flat flow.resources map", () => {
      const block = handler({
        name: "with-proj-res",
        resources: { orgArtifacts: orgArtifactsResource },
        execute: (v) => v
      });

      const flow = defineFlow({
        kind: "proj-res",
        actions: {
          run: { inputSchema: z.any(), block }
        }
      });

      expect(flow.resources).toEqual({
        orgArtifacts: orgArtifactsResource
      });
    });

    it("flow-level resources take priority over block-declared resources at the same accessor", () => {
      const block = handler({
        name: "block-obs",
        resources: { observations: observationsResource },
        execute: (v) => v
      });

      const flow = defineFlow({
        kind: "flow-wins",
        actions: {
          run: { inputSchema: z.any(), block }
        },
        resources: { observations: flowLevelResource }
      });

      // Flow-level wins — should be the flowLevelResource, not observationsResource
      expect(flow.resources?.observations).toBe(flowLevelResource);
    });

    it("merges disjoint flow-level and block-declared resources into the flat map", () => {
      const block = handler({
        name: "block-obs",
        resources: { observations: observationsResource },
        execute: (v) => v
      });

      const flow = defineFlow({
        kind: "disjoint",
        actions: {
          run: { inputSchema: z.any(), block }
        },
        resources: { counter: flowLevelResource }
      });

      expect(flow.resources).toEqual({
        observations: observationsResource,
        counter: flowLevelResource
      });
    });

    it("merges resources from multiple actions into the flat map", () => {
      const blockA = handler({
        name: "a",
        resources: { observations: observationsResource },
        execute: (v) => v
      });
      const blockB = handler({
        name: "b",
        resources: { artifacts: artifactsResource },
        execute: (v) => v
      });

      const flow = defineFlow({
        kind: "multi-action",
        actions: {
          run: { inputSchema: z.any(), block: blockA },
          other: { inputSchema: z.any(), block: blockB }
        }
      });

      expect(flow.resources).toEqual({
        observations: observationsResource,
        artifacts: artifactsResource
      });
    });

    it("collects resources from sequencer blocks (nested collection)", () => {
      const innerBlock = handler({
        name: "inner",
        resources: { observations: observationsResource },
        execute: (v) => v
      });
      const seq = sequencer({ name: "pipeline" }).then(innerBlock);

      const flow = defineFlow({
        kind: "seq-res",
        actions: {
          run: { inputSchema: z.any(), block: seq }
        }
      });

      expect(flow.resources).toEqual({
        observations: observationsResource
      });
    });

    it("preserves existing flow scope config when bubbling block resources", () => {
      const block = handler({
        name: "with-res",
        resources: { observations: observationsResource },
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
      expect(flow.resources).toEqual({
        observations: observationsResource
      });
    });

    it("leaves flow.resources undefined when no resources are declared anywhere", () => {
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

      expect(flow.resources).toBeUndefined();
      expect(flow.session).toBeUndefined();
      expect(flow.user).toBeUndefined();
      expect(flow.org).toBeUndefined();
    });

    it("bubbles block resources into flow instances created via the factory", () => {
      const block = handler({
        name: "with-res",
        resources: { observations: observationsResource },
        execute: (v) => v
      });

      const flow = defineFlow({
        kind: "instance-merge",
        actions: {
          run: { inputSchema: z.any(), block }
        }
      });

      const instance = flow({ id: "test" });
      expect(instance.resources).toEqual({
        observations: observationsResource
      });
    });

    // Regression: the effective-storage-key tuple is JSON-encoded so adjacent
    // string fields can't ambiguously concatenate. Resources whose `ref` and
    // `flowKind` would have aliased to the same naive concatenation must
    // resolve to distinct tuples.
    it("does not falsely collide resources whose fields would naively concat to the same string", () => {
      const resA = defineResource({
        ref: "x",
        scope: "user",
        flowIsolation: true,
        stateSchema: z.object({})
      });
      const resB = defineResource({
        ref: "x1y0",
        scope: "user",
        flowIsolation: false,
        stateSchema: z.object({})
      });

      // Pre-fix this would have rejected the build because both tuples
      // concatenated to "userx1y0" under the previous tupleKey impl.
      expect(() =>
        defineFlow({
          kind: "y",
          actions: {},
          resources: { a: resA, b: resB }
        })({ id: "y" })
      ).not.toThrow();
    });
  });

  describe("scope client config normalization (FIX-505)", () => {
    it("accepts client.expose + client.derived and exposes a normalized client", () => {
      const flow = defineFlow({
        kind: "ccnorm-1",
        actions: {},
        session: {
          stateSchema: z.object({
            count: z.number().default(0),
            name: z.string().default("")
          }),
          client: {
            expose: ["count"],
            derived: { greeting: (ctx) => `hi ${(ctx.state as { name?: string }).name ?? ""}` }
          }
        }
      });
      expect(flow.session?.client?.expose).toEqual(["count"]);
      expect(typeof flow.session?.client?.derived?.greeting).toBe("function");
      expect((flow.session as { clientData?: unknown })?.clientData).toBeUndefined();
    });

    it("normalizes legacy clientData into client.derived and warns once per scope", async () => {
      const { __resetDeprecationWarningsForTests } = await import("../src/utils/deprecation");
      __resetDeprecationWarningsForTests();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const flow = defineFlow({
        kind: "ccnorm-2",
        actions: {},
        session: {
          stateSchema: z.object({}),
          clientData: { legacy: () => ({ ok: true }) }
        }
      });
      flow({ id: "ccnorm-2-instance" });

      expect(typeof flow.session?.client?.derived?.legacy).toBe("function");
      expect((flow.session as { clientData?: unknown })?.clientData).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it("throws when both client and clientData are set on the same scope", () => {
      expect(() =>
        defineFlow({
          kind: "ccnorm-3",
          actions: {},
          session: {
            stateSchema: z.object({}),
            client: { derived: { a: () => 1 } },
            clientData: { b: () => 2 }
          }
        })
      ).toThrow(/sets both session\.client and session\.clientData/);
    });

    it("throws when expose and derived share a name", () => {
      expect(() =>
        defineFlow({
          kind: "ccnorm-4",
          actions: {},
          session: {
            stateSchema: z.object({ count: z.number().default(0) }),
            client: {
              expose: ["count"],
              derived: { count: () => 99 }
            }
          }
        })
      ).toThrow(/overlapping names in expose and derived/);
    });

    it("throws when expose names a key not on stateSchema (introspectable)", () => {
      expect(() =>
        defineFlow({
          kind: "ccnorm-5",
          actions: {},
          session: {
            stateSchema: z.object({ count: z.number().default(0) }),
            client: { expose: ["missing" as "count"] }
          }
        })
      ).toThrow(/expose names key\(s\) not on session\.stateSchema/);
    });

    it("skips expose validation when stateSchema is not introspectable", () => {
      expect(() =>
        defineFlow({
          kind: "ccnorm-6",
          actions: {},
          session: {
            stateSchema: z.unknown(),
            client: { expose: ["whatever" as never] }
          }
        })
      ).not.toThrow();
    });
  });
});
