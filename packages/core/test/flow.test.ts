import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, generator, handler } from "../src";
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
    let attempts = 0;
    let modelCalls = 0;
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
        async generate() {
          if (modelCalls === 0) {
            modelCalls += 1;
            return {
              toolCalls: [
                {
                  toolCallId: "tool-1",
                  toolName: "flaky-tool",
                  args: { text: "hello" }
                }
              ]
            };
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

    expect(attempts).toBe(2);
    expect(onToolStarted).toHaveBeenCalledTimes(1);
    expect(onToolCompleted).toHaveBeenCalledTimes(1);
    expect(onToolErrored).not.toHaveBeenCalled();
  });

  it("allows instance tool hooks to override flow hooks", async () => {
    let modelCalls = 0;
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
        async generate() {
          if (modelCalls === 0) {
            modelCalls += 1;
            return {
              toolCalls: [
                {
                  toolCallId: "tool-1",
                  toolName: "ok-tool",
                  args: { text: "hello" }
                }
              ]
            };
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
});
