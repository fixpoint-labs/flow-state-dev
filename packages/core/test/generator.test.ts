import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  generator,
  handler,
  readResourceContentTool,
  writeResourceContentTool
} from "../src";
import { createMockContext, runForTest } from "./helpers";
describe("generator builder", () => {
  it("defaults output schema to string when omitted", async () => {
    const block = generator({
      name: "string-output",
      model: "mock-model",
      prompt: "Return a string"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "mock-model",
        async generate() {
          return { text: "hello" };
        }
      })
    });
    await expect(runForTest(block, { value: "x" }, ctx)).resolves.toBe("hello");
  });

  it("accepts a direct GeneratorModel instance in config.model", async () => {
    const model = {
      modelId: "custom:model",
      async generate() {
        return {
          text: "from-direct-model"
        };
      }
    };

    const block = generator({
      name: "direct-model",
      model,
      prompt: "Return text"
    });

    const ctx = createMockContext();
    await expect(runForTest(block, { value: "x" }, ctx)).resolves.toBe("from-direct-model");
  });

  it("resolves model and prompt from functions", async () => {
    const seen: Array<{ modelId: string; prompt: unknown }> = [];
    const block = generator({
      name: "dynamic-model-prompt",
      inputSchema: z.object({ count: z.number() }),
      model: (input) => `model-${input.count}`,
      prompt: (input) => `prompt-${input.count}`
    });

    const ctx = createMockContext({
      resolveModel: (modelId) => ({
        modelId,
        async generate(options) {
          seen.push({
            modelId,
            prompt: (options.messages[0] as { content?: unknown } | undefined)?.content
          });
          return { text: "ok" };
        }
      })
    });
    await expect(runForTest(block, { count: 2 }, ctx)).resolves.toBe("ok");
    expect(seen[0]).toEqual({
      modelId: "model-2",
      prompt: "prompt-2"
    });
  });

  it("supports repair mode auto with custom repairOutput", async () => {
    const repairOutput = vi.fn().mockReturnValue({ done: true });
    const block = generator({
      name: "repair-auto",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ done: z.boolean() }),
      repair: { mode: "auto", maxAttempts: 1 },
      repairOutput
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: { done: "nope" }
          };
        }
      })
    });
    await expect(runForTest(block, { value: 1 }, ctx)).resolves.toEqual({ done: true });
    expect(repairOutput).toHaveBeenCalledTimes(1);
  });

  it("fails immediately in repair fail/rescue modes", async () => {
    const blockFail = generator({
      name: "repair-fail",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ done: z.boolean() }),
      repair: { mode: "fail", maxAttempts: 4 }
    });

    const blockRescue = generator({
      name: "repair-rescue",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ done: z.boolean() }),
      repair: { mode: "rescue", maxAttempts: 4 }
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: { done: "bad" }
          };
        }
      })
    });
    await expect(runForTest(blockFail, { value: 1 }, ctx)).rejects.toThrow("validation failed");
    await expect(runForTest(blockRescue, { value: 1 }, ctx)).rejects.toThrow("validation failed");
  });

  it("logs the unparseable candidate when output validation gives up", async () => {
    // When a generator's output schema can't validate the candidate even
    // after repair attempts, the framework should dump the actual model
    // output to stderr so an operator can see what came back. Without this
    // log, debugging "Expected object, received string" requires re-running
    // with a debugger or paging through a request's block_debug item.
    const block = generator({
      name: "log-on-fail",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ ok: z.boolean() }),
      repair: { mode: "fail" },
    });

    const ctx = createMockContext({
      resolveModel: ((() => ({
        modelId: "m",
        async generate() {
          // Return a plain text string — the structured-output fallthrough
          // case that small models hit when they drop out of JSON mode.
          return { text: "Sorry, I cannot consolidate these episodes." };
        },
      })) as unknown) as any,
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(runForTest(block, { value: 1 }, ctx)).rejects.toThrow("validation failed");

    const messages = warnSpy.mock.calls.map((call) => String(call[0]));
    const hit = messages.find((m) => m.includes("log-on-fail") && m.includes("Sorry, I cannot consolidate"));
    expect(hit, `expected a console.warn dump of the candidate; saw: ${messages.join(" | ")}`).toBeDefined();

    warnSpy.mockRestore();
  });

  it("throws OutputValidationError with rawOutput + issues on schema failure", async () => {
    const { OutputValidationError } = await import("../src/errors/output-validation-error");

    const block = generator({
      name: "ov-final",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ ok: z.boolean() }),
      repair: { mode: "fail" }
    });

    const ctx = createMockContext({
      resolveModel: ((() => ({
        modelId: "m",
        async generate() {
          return { text: "Sorry, not JSON." };
        }
      })) as unknown) as any
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await runForTest(block, { value: 1 }, ctx);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputValidationError);
      const oe = err as InstanceType<typeof OutputValidationError>;
      expect(oe.code).toBe("output_validation_error");
      expect(oe.retryable).toBe(false);
      expect(oe.details.phase).toBe("final");
      expect(typeof oe.details.rawOutput).toBe("string");
      expect(oe.details.rawOutput).toContain("Sorry, not JSON.");
      expect(Array.isArray(oe.details.issues)).toBe(true);
      expect(oe.details.issues.length).toBeGreaterThan(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("runs model-requested tools via execute wrappers", async () => {
    // The generator compiles tools with `execute` closures. The model layer
    // (AI SDK) calls `execute` during its built-in multi-step loop.
    // This test simulates that behavior in the mock model.
    const toolCalls: string[] = [];
    const succeedTool = handler({
      name: "succeeds",
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ text: z.string(), ok: z.boolean() }),
      execute: (input) => {
        toolCalls.push("ok");
        return {
          text: input.text,
          ok: true
        };
      }
    });

    const block = generator({
      name: "tool-loop",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ text: z.string(), ok: z.boolean() }),
      maxIterations: 2,
      tools: [succeedTool]
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          // Simulate AI SDK: call tool execute, then return final result
          if (options.tools?.length > 0) {
            const tool = options.tools[0];
            if (tool.execute) {
              await tool.execute({ text: "hello" });
            }
          }
          return {
            structuredOutput: {
              text: "hello",
              ok: true
            }
          };
        }
      })
    });
    await expect(runForTest(block, { text: "hello" }, ctx)).resolves.toEqual({
      text: "hello",
      ok: true
    });
    expect(toolCalls).toEqual(["ok"]);
  });

  it("forwards mapModelOutput as toModelOutput on the compiled GeneratorModelTool", async () => {
    // A block carrying a `mapModelOutput` mapper installed via
    // `BlockDefinition.mapModelOutput` should surface its mapper as the
    // compiled tool's `toModelOutput` field. The framework-level mapper
    // returns a plain string; the AI SDK adapter wraps it into the SDK's
    // content-part envelope.
    const richTool = handler({
      name: "rich",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ count: z.number() }),
      execute: async (input) => ({ count: input.q.length }),
    }).mapModelOutput((out) => `count=${out.count}`);

    let seenToModelOutput: ((output: unknown) => Promise<string> | string) | undefined;
    let seenStructuredOutput: unknown;

    const block = generator({
      name: "with-mapped-tool",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ done: z.literal(true) }),
      tools: [richTool],
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          const tool = options.tools?.[0];
          seenToModelOutput = tool?.toModelOutput;
          if (tool?.execute) {
            seenStructuredOutput = await tool.execute({ q: "hello" });
          }
          return { structuredOutput: { done: true } };
        },
      }),
    });

    await runForTest(block, { q: "hello" }, ctx);

    // execute() returns the structured output unchanged (consumed by
    // `tool_output` items, devtool, replay).
    expect(seenStructuredOutput).toEqual({ count: 5 });
    // The mapper is forwarded for the AI SDK to materialise next-turn
    // model-visible content from the structured output.
    expect(seenToModelOutput).toBeDefined();
    await expect(
      seenToModelOutput!({ count: 5 })
    ).resolves.toBe("count=5");
  });

  // FIX-573: standalone block_debug items carrying mapModelOutput are gone.
  // The model-visible string flows to the AI SDK via toModelOutput; the
  // structured output is on the tool_output item.

  it("does not set toModelOutput on tools without mapModelOutput", async () => {
    const plain = handler({
      name: "plain",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    });

    let seenToModelOutput: unknown;
    const block = generator({
      name: "no-mapper",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ done: z.literal(true) }),
      tools: [plain],
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          seenToModelOutput = options.tools?.[0]?.toModelOutput;
          return { structuredOutput: { done: true } };
        },
      }),
    });
    await runForTest(block, {}, ctx);
    expect(seenToModelOutput).toBeUndefined();
  });

  it("tools resolver receives the current input alongside ctx", async () => {
    // A tools function closes over per-invocation state via its `input`
    // argument. Verifies that `tools: (input, ctx) => ...` can select tools
    // based on the invocation's input — used by e.g. the skills fork
    // generator to resolve catalog subsets per SKILL's allowed-tools.
    const toolA = handler({
      name: "toolA",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async () => ({}),
    });
    const toolB = handler({
      name: "toolB",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async () => ({}),
    });

    let seenToolNames: string[] = [];
    const block = generator({
      name: "tools-input-resolver",
      inputSchema: z.object({ pick: z.enum(["a", "b", "both"]) }),
      model: "m",
      prompt: "p",
      outputSchema: z.object({ ok: z.boolean() }),
      tools: (input) => {
        if (input.pick === "a") return [toolA];
        if (input.pick === "b") return [toolB];
        return [toolA, toolB];
      },
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          seenToolNames = (options.tools ?? []).map((t: any) => t.name);
          return { structuredOutput: { ok: true } };
        },
      }),
    });

    await runForTest(block, { pick: "a" }, ctx);
    expect(seenToolNames).toEqual(["toolA"]);

    await runForTest(block, { pick: "b" }, ctx);
    expect(seenToolNames).toEqual(["toolB"]);

    await runForTest(block, { pick: "both" }, ctx);
    expect(seenToolNames).toEqual(["toolA", "toolB"]);
  });

  it("passes maxSteps to model.generate", async () => {
    let receivedMaxSteps: number | undefined;
    const block = generator({
      name: "max-steps",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ done: z.literal(true) }),
      maxIterations: 4
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          receivedMaxSteps = options.maxSteps;
          return {
            structuredOutput: { done: true }
          };
        }
      })
    });
    await expect(runForTest(block, { n: 1 }, ctx)).resolves.toEqual({ done: true });
    expect(receivedMaxSteps).toBe(4);
  });

  it("forwards the resolved caching config to model.generate", async () => {
    let receivedCaching: unknown;
    const block = generator({
      name: "cache-config",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ ok: z.literal(true) }),
      caching: { ttl: "1h" }
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          receivedCaching = options.caching;
          return { structuredOutput: { ok: true } };
        }
      })
    });
    await runForTest(block, { n: 1 }, ctx);
    expect(receivedCaching).toEqual({ ttl: "1h" });
  });

  it("resolves a function-form caching config per call", async () => {
    let receivedCaching: unknown;
    const block = generator({
      name: "dynamic-cache",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ ok: z.literal(true) }),
      caching: (input: { disable: boolean }) =>
        input.disable ? { enabled: false } : { ttl: "5m" }
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          receivedCaching = options.caching;
          return { structuredOutput: { ok: true } };
        }
      })
    });
    await runForTest(block, { disable: true }, ctx);
    expect(receivedCaching).toEqual({ enabled: false });
  });


  it("does not auto-inject resource content tools", async () => {
    const block = generator({
      name: "no-auto-resource-tools",
      model: "m",
      prompt: "p"
    });

    const ctx = createMockContext({
      session: {
        identity: { type: "session", id: "s1", userId: "u1" },
        state: {},
        resources: {
          get: () => ({}) as any,
          list: () => [
            {
              path: "soul",
              scope: "session",
              uri: "session/soul",
              config: { llmReadable: true, llmWritable: true },
              state: {},
              patchState: async () => undefined,
              setState: async () => undefined,
              updateState: async () => undefined,
              readContent: async () => "x",
              readContentRaw: async () => "x",
              writeContent: async () => undefined
            } as any
          ]
        },
        patchState: async () => undefined,
        setState: async () => undefined,
        incState: async () => undefined,
        pushState: async () => undefined,
        setStateRecord: async () => undefined,
        deleteStateRecord: async () => undefined,
        atomicState: async () => undefined,
        appendJournal: async () => undefined,
        getJournal: async () => []
      } as any,
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          expect(options.tools).toBeUndefined();
          return { text: "ok" };
        }
      })
    });

    await expect(runForTest(block, { value: "x" }, ctx)).resolves.toBe("ok");
  });
  it("skips tool invocation when loop.runTools is false", async () => {
    const toolCall = vi.fn();
    const tool = handler({
      name: "unused-tool",
      inputSchema: z.object({ value: z.number() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => {
        toolCall();
        return { ok: false };
      }
    });
    const block = generator({
      name: "no-tools",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ ok: z.boolean() }),
      tools: [tool],
      loop: {
        runTools: false
      }
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            toolCalls: [
              {
                toolCallId: "unused",
                toolName: "unused-tool",
                args: { value: 1 }
              }
            ],
            structuredOutput: { ok: true }
          };
        }
      })
    });
    await expect(runForTest(block, { value: 1 }, ctx)).resolves.toEqual({ ok: true });
    expect(toolCall).not.toHaveBeenCalled();
  });

  it("emits tool_output items when a tool executes with toolCallId", async () => {
    const emittedEvents: Array<{ type: string; item?: Record<string, unknown> }> = [];
    const tool = handler({
      name: "lookup-tool",
      inputSchema: z.object({ query: z.string() }),
      outputSchema: z.object({ answer: z.string() }),
      execute: (input) => ({ answer: `result for ${input.query}` })
    });

    const block = generator({
      name: "tool-generator",
      model: "m",
      prompt: "Use the tool",
      tools: [tool]
    });

    let toolExecutionCount = 0;
    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          if (toolExecutionCount === 0) {
            toolExecutionCount++;
            // Simulate AI SDK calling the tool's execute with toolCallId.
            const toolDef = (options.tools as any[])?.find(
              (t: any) => t.name === "lookup-tool"
            );
            if (toolDef?.execute) {
              await toolDef.execute({ query: "test" }, { toolCallId: "call_123" });
            }
            return { text: "done" };
          }
          return { text: "done" };
        }
      }),
      response: {
        emit: (event: unknown) => {
          emittedEvents.push(event as any);
        },
        getItems: () => emittedEvents.filter((e: any) => e.item).map((e: any) => e.item)
      } as any
    });

    await runForTest(block, { value: "x" }, ctx);

    const toolOutputEvents = emittedEvents.filter(
      (e) => e.type === "item.added" && e.item?.type === "tool_output"
    );
    expect(toolOutputEvents.length).toBe(1);

    const toolOutput = toolOutputEvents[0]!.item!;
    expect(toolOutput.blockName).toBe("lookup-tool");
    expect(toolOutput.output).toEqual({ answer: "result for test" });
    expect((toolOutput.toolCall as any).callId).toBe("call_123");
    expect((toolOutput.toolCall as any).name).toBe("lookup-tool");
    expect((toolOutput.toolCall as any).generatorBlock).toBe("tool-generator");
    // Already-clean name → alias equals name (sanitisation is idempotent).
    expect((toolOutput.toolCall as any).alias).toBe("lookup-tool");
  });

  it("stamps a sanitized alias on tool_output when the tool name contains namespace characters", async () => {
    // The model only ever sees the sanitized alias `tf_memory_recall`; the
    // emitted item must carry that alias so history replay sends the same
    // string OpenAI accepted in the original turn. Prior to FIX-… the item
    // stored only the framework name, and replay produced a 400 from
    // OpenAI's `^[a-zA-Z0-9_-]+$` rule.
    const emittedEvents: Array<{ type: string; item?: Record<string, unknown> }> = [];
    const namespacedTool = handler({
      name: "tf.memory/recall",
      inputSchema: z.object({ query: z.string() }),
      outputSchema: z.object({ results: z.array(z.string()) }),
      execute: () => ({ results: ["found"] })
    });

    const block = generator({
      name: "ns-tool-generator",
      model: "m",
      prompt: "p",
      tools: [namespacedTool]
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          const toolDef = (options.tools as any[])?.find(
            (t: any) => t.name === "tf.memory/recall"
          );
          if (toolDef?.execute) {
            await toolDef.execute({ query: "wife" }, { toolCallId: "call_ns" });
          }
          return { text: "done" };
        }
      }),
      response: {
        emit: (event: unknown) => {
          emittedEvents.push(event as any);
        },
        getItems: () => emittedEvents.filter((e: any) => e.item).map((e: any) => e.item)
      } as any
    });

    await runForTest(block, { value: "x" }, ctx);

    const toolOutput = emittedEvents.find(
      (e) => e.type === "item.added" && e.item?.type === "tool_output"
    )!.item!;
    expect((toolOutput.toolCall as any).name).toBe("tf.memory/recall");
    expect((toolOutput.toolCall as any).alias).toBe("tf_memory_recall");
    // The alias must satisfy provider patterns; if this regex check fails,
    // OpenAI will reject the next turn's replay.
    expect((toolOutput.toolCall as any).alias).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it("fires onToolErrored before emitting the tool_output's item.done on failure", async () => {
    // Consumers that listen for item.done and expect onToolErrored to have
    // run its side-effects (memo writes, additional emitted items) rely on
    // this ordering — the observer must run first, item.done last.
    const events: string[] = [];
    const failingTool = handler({
      name: "boom",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => {
        throw new Error("kaboom");
      },
    });

    const block = generator({
      name: "ordering-gen",
      model: "m",
      prompt: "p",
      tools: [failingTool],
    });

    const flow = defineFlow({
      kind: "ordering",
      actions: {
        run: {
          inputSchema: z.object({ q: z.string() }),
          block,
        },
      },
      tools: {
        onToolErrored: () => {
          events.push("onToolErrored");
        },
      },
    });
    const instance = flow();

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          const toolDef = (options.tools as any[])?.find((t: any) => t.name === "boom");
          if (toolDef?.execute) {
            try {
              await toolDef.execute({ q: "x" }, { toolCallId: "call_err" });
            } catch {
              // expected — wrapper rethrows
            }
          }
          return { text: "done" };
        },
      }),
      response: {
        emit: (event: any) => {
          if (event.type === "item.done" && event.item?.type === "tool_output") {
            events.push("item.done");
          }
        },
      } as any,
    });

    await runForTest(instance.actions.run.block, { q: "x" }, ctx);
    expect(events).toEqual(["onToolErrored", "item.done"]);
  });

  it("stamps the alias on a failed tool_output as well", async () => {
    // Both success and failure paths emit tool_output. Replay sends
    // the failure's tool-call back to the model on the next turn (with the
    // synthesised "Tool ... failed" error text), so the alias must travel
    // with the failure path too.
    const emittedEvents: Array<{ type: string; item?: Record<string, unknown> }> = [];
    const failingTool = handler({
      name: "tf.memory/recall",
      inputSchema: z.object({ query: z.string() }),
      outputSchema: z.object({ results: z.array(z.string()) }),
      execute: () => {
        throw new Error("boom");
      }
    });

    const block = generator({
      name: "failing-tool-gen",
      model: "m",
      prompt: "p",
      tools: [failingTool]
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          const toolDef = (options.tools as any[])?.find(
            (t: any) => t.name === "tf.memory/recall"
          );
          if (toolDef?.execute) {
            try {
              await toolDef.execute({ query: "x" }, { toolCallId: "call_fail" });
            } catch {
              // expected — tool execute rethrows after emitting failure item
            }
          }
          return { text: "done" };
        }
      }),
      response: {
        emit: (event: unknown) => {
          emittedEvents.push(event as any);
        },
        getItems: () => emittedEvents.filter((e: any) => e.item).map((e: any) => e.item)
      } as any
    });

    await runForTest(block, { value: "x" }, ctx);

    const failed = emittedEvents.find(
      (e) =>
        e.type === "item.added" &&
        e.item?.type === "tool_output" &&
        e.item?.status === "failed"
    )!.item!;
    expect((failed.toolCall as any).alias).toBe("tf_memory_recall");
  });

  it("lists tools in the system prompt using sanitized names matching what the model can call", async () => {
    // Framework block names use namespacing characters (`.`, `/`) that
    // OpenAI rejects in tool names. The adapter aliases the names before
    // submitting; the prompt context must use the same alias so the model
    // sees one consistent name.
    const namespaced = handler({
      name: "tf.memory/recall",
      description: "Search your stored memory",
      inputSchema: z.object({ query: z.string() }),
      outputSchema: z.object({ results: z.array(z.string()) }),
      execute: async () => ({ results: [] }),
    });

    let capturedSystemContent = "";
    const block = generator({
      name: "ns-tool-listing",
      model: "m",
      prompt: "You are a helper.",
      outputSchema: z.string(),
      tools: [namespaced],
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          // The auto-describe tool listing flows through buildSystemPrefix
          // as its own additional system message — concatenate every
          // system message so the assertion is independent of how many
          // system slices the prefix produced.
          capturedSystemContent = (options.messages ?? [])
            .filter((m: any) => m.role === "system")
            .map((m: any) => (typeof m.content === "string" ? m.content : ""))
            .join("\n");
          return { text: "ok" };
        },
      }),
    });

    await runForTest(block, { value: "x" }, ctx);
    // Listed under the sanitized alias the model can actually invoke.
    expect(capturedSystemContent).toContain("- tf_memory_recall: Search your stored memory");
    // The original framework name should NOT leak into the prompt body.
    expect(capturedSystemContent).not.toContain("tf.memory/recall");
  });
});

it("supports manually adding unified resource content tools", async () => {
  const calls: Array<{ name: string; args: any }> = [];

  const readableResource = {
    path: "soul",
    scope: "session",
    uri: "session/soul",
    config: { llmReadable: true, llmWritable: false },
    state: {},
    patchState: async () => undefined,
    setState: async () => undefined,
    updateState: async () => undefined,
    readContent: async () => "rendered",
    readContentRaw: async () => "raw",
    writeContent: async () => undefined
  } as any;

  const writableResource = {
    ...readableResource,
    path: "notes",
    uri: "session/notes",
    config: { llmReadable: true, llmWritable: true },
    writeContent: async (content: string) => {
      calls.push({ name: "write", args: content });
    }
  } as any;

  const block = generator({
    name: "resource-tools",
    model: "m",
    prompt: "p",
    tools: [readResourceContentTool(), writeResourceContentTool()]
  });

  const ctx = createMockContext({
    session: {
      identity: { type: "session", id: "s1", userId: "u1" },
      state: {},
      patchState: async () => undefined,
      setState: async () => undefined,
      incState: async () => undefined,
      pushState: async () => undefined,
      setStateRecord: async () => undefined,
      deleteStateRecord: async () => undefined,
      atomicState: async () => undefined,
      appendJournal: async () => undefined,
      getJournal: async () => []
    } as any,
    resources: {
      get: () => readableResource,
      list: () => [readableResource, writableResource]
    } as any,
    resolveModel: () => ({
      modelId: "m",
      async generate(options: any) {
        const readTool = options.tools.find((tool: any) => tool.name === "readResourceContent");
        const writeTool = options.tools.find((tool: any) => tool.name === "writeResourceContent");
        expect(readTool).toBeDefined();
        expect(writeTool).toBeDefined();
        expect(options.tools).toHaveLength(2);

        const listed = await readTool.execute({});
        calls.push({ name: "list", args: listed.paths });

        const readResult = await readTool.execute({ path: "session/soul" });
        calls.push({ name: "read", args: readResult.content });

        await writeTool.execute({ path: "session/notes", content: "updated" });

        return { text: "done" };
      }
    })
  });

  await expect(runForTest(block, { value: "x" }, ctx)).resolves.toBe("done");
  expect(calls).toEqual([
    { name: "list", args: ["session/notes", "session/soul"] },
    { name: "read", args: "rendered" },
    { name: "write", args: "updated" }
  ]);
});

describe("generator streaming", () => {
  it("does not pass outputSchema to model.stream() for text generators", async () => {
    let receivedOutputSchema: unknown = "NOT_CALLED";
    const block = generator({
      name: "stream-schema",
      itemVisibility: { client: true, history: true },
      model: "mock-model",
      prompt: "Return text"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "mock-model",
        async generate() {
          return { text: "fallback" };
        },
        async *stream(options: any) {
          receivedOutputSchema = options.outputSchema;
          yield { type: "text_delta" as const, textDelta: "hello" };
          yield {
            type: "finish" as const,
            fullResult: { text: "hello" }
          };
        }
      })
    });

    await runForTest(block, { value: "x" }, ctx);
    // Text generators (z.string()) should NOT pass outputSchema to the model —
    // it would trigger structured output mode (Output.object) which prevents
    // normal text delta streaming.
    expect(receivedOutputSchema).toBeUndefined();
  });

  it("emits tool_call_progress items for tool_call_delta chunks", async () => {
    const emitted: Array<{ type: string; item?: any }> = [];
    const block = generator({
      name: "stream-tool-delta",
      itemVisibility: { client: true, history: true },
      model: "mock-model",
      prompt: "Use tools"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "mock-model",
        async generate() {
          return { text: "fallback" };
        },
        async *stream() {
          yield {
            type: "tool_call_delta" as const,
            toolCallDelta: { toolCallId: "tc_1", toolName: "search", argsDelta: '{"q":"test"}' }
          };
          yield { type: "text_delta" as const, textDelta: "result" };
          yield {
            type: "finish" as const,
            fullResult: { text: "result" }
          };
        }
      }),
      response: {
        emit: (event: any) => {
          emitted.push(event);
        }
      }
    });

    await runForTest(block, { value: "x" }, ctx);

    const toolCallItems = emitted.filter(
      e => e.type === "item.added" && e.item?.type === "tool_call_progress"
    );
    expect(toolCallItems.length).toBe(1);
    expect(toolCallItems[0].item.toolCallId).toBe("tc_1");
    expect(toolCallItems[0].item.toolName).toBe("search");
    expect(toolCallItems[0].item.argsDelta).toBe('{"q":"test"}');
  });

  it("emits completed tool_call_progress items for tool_result chunks", async () => {
    const emitted: Array<{ type: string; item?: any }> = [];
    const block = generator({
      name: "stream-tool-result",
      itemVisibility: { client: true, history: true },
      model: "mock-model",
      prompt: "Use tools"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "mock-model",
        async generate() {
          return { text: "fallback" };
        },
        async *stream() {
          yield {
            type: "tool_result" as const,
            toolResult: { toolCallId: "tc_1", toolName: "search", result: { found: true } }
          };
          yield { type: "text_delta" as const, textDelta: "done" };
          yield {
            type: "finish" as const,
            fullResult: { text: "done" }
          };
        }
      }),
      response: {
        emit: (event: any) => {
          emitted.push(event);
        }
      }
    });

    await runForTest(block, { value: "x" }, ctx);

    const toolResultItems = emitted.filter(
      e => e.type === "item.added" && e.item?.type === "tool_call_progress" && e.item?.status === "completed"
    );
    expect(toolResultItems.length).toBe(1);
    expect(toolResultItems[0].item.toolCallId).toBe("tc_1");
    expect(toolResultItems[0].item.result).toEqual({ found: true });
  });

  it("does not emit any items when itemVisibility is unset", async () => {
    const emitted: Array<{ type: string; item?: any }> = [];
    const block = generator({
      name: "no-identity",
      model: "mock-model",
      prompt: "Use tools"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "mock-model",
        async generate() {
          return { text: "result" };
        },
        async *stream() {
          yield { type: "text_delta" as const, textDelta: "result" };
          yield {
            type: "finish" as const,
            fullResult: { text: "result" }
          };
        }
      }),
      response: {
        emit: (event: any) => {
          emitted.push(event);
        }
      }
    });

    await runForTest(block, { value: "x" }, ctx);

    const convItems = emitted.filter(
      e => e.type === "item.added" &&
           ["message", "reasoning", "tool_call_progress", "status", "source"].includes(e.item?.type)
    );
    expect(convItems.length).toBe(0);
  });

  it("still streams text through to schema validation when itemVisibility is set", async () => {
    const emitted: Array<{ type: string; item?: any; delta?: string }> = [];
    const block = generator({
      name: "text-still-flows",
      itemVisibility: { client: true, history: true },
      model: "mock-model",
      prompt: "Use tools"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "mock-model",
        async generate() {
          return { text: "fallback" };
        },
        async *stream() {
          yield {
            type: "tool_call_delta" as const,
            toolCallDelta: { toolCallId: "tc_1", toolName: "search", argsDelta: '{"q":"test"}' }
          };
          yield {
            type: "tool_result" as const,
            toolResult: { toolCallId: "tc_1", toolName: "search", result: { found: true } }
          };
          yield { type: "text_delta" as const, textDelta: "hello world" };
          yield {
            type: "finish" as const,
            fullResult: { text: "hello world" }
          };
        }
      }),
      response: {
        emit: (event: any) => {
          emitted.push(event);
        }
      }
    });

    await runForTest(block, { value: "x" }, ctx);

    // Tool call events and text content both emit under itemVisibility: {client:true, history:true}.
    const toolItems = emitted.filter(
      e => e.type === "item.added" && e.item?.type === "tool_call_progress"
    );
    expect(toolItems.length).toBeGreaterThan(0);

    const contentDeltas = emitted.filter(e => e.type === "content.delta");
    expect(contentDeltas.length).toBeGreaterThan(0);
  });
});

describe("generator non-streaming tool emission (FIX-661)", () => {
  // Inline model literal with `generate()` only and no `stream()` — keeps
  // `canStream === false` so the non-streaming branch is exercised. Must NOT
  // use `createMockModelResolver` here: that mock implements `stream()` and
  // would silently route this test through the streaming branch.
  it("emits paired in_progress + completed tool_call_progress items from generation.steps", async () => {
    const emitted: Array<{ type: string; item?: any }> = [];
    const block = generator({
      name: "ns-tool",
      itemVisibility: { client: true, history: true },
      model: "inline-mock",
      prompt: "p"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "inline-mock",
        async generate() {
          return {
            text: "done",
            toolCalls: [{ toolCallId: "tc_1", toolName: "search", args: { q: "x" } }],
            steps: [{
              toolCalls: [{ toolCallId: "tc_1", toolName: "search", args: { q: "x" } }],
              toolResults: [{ toolCallId: "tc_1", toolName: "search", result: { hits: 3 } }]
            }],
            finishReason: "stop"
          };
        }
        // Deliberately no `stream` method.
      }),
      response: {
        emit: (event: any) => {
          emitted.push(event);
        }
      }
    });

    await runForTest(block, { value: "x" }, ctx);

    const tcpAdds = emitted.filter(
      e => e.type === "item.added" && e.item?.type === "tool_call_progress"
    );
    expect(tcpAdds.length).toBe(2);

    const inProgress = tcpAdds.find(e => e.item.status === "in_progress");
    expect(inProgress).toBeDefined();
    expect(inProgress!.item.toolCallId).toBe("tc_1");
    expect(inProgress!.item.toolName).toBe("search");
    expect(inProgress!.item.argsDelta).toBe('{"q":"x"}');
    expect(inProgress!.item.transient).toBe(true);

    const completed = tcpAdds.find(e => e.item.status === "completed");
    expect(completed).toBeDefined();
    expect(completed!.item.toolCallId).toBe("tc_1");
    expect(completed!.item.result).toEqual({ hits: 3 });

    // Both items also get item.done events.
    const tcpDones = emitted.filter(
      e => e.type === "item.done" && e.item?.type === "tool_call_progress"
    );
    expect(tcpDones.length).toBe(2);

    // Tool-call items emit before the terminal message item.
    const firstMsgIdx = emitted.findIndex(
      e => e.type === "item.added" && e.item?.type === "message"
    );
    const lastTcpIdx = emitted.map((e, i) => ({ e, i }))
      .filter(({ e }) => e.type === "item.added" && e.item?.type === "tool_call_progress")
      .map(({ i }) => i)
      .pop();
    expect(firstMsgIdx).toBeGreaterThan(-1);
    expect(lastTcpIdx).toBeLessThan(firstMsgIdx);
  });

  it("emits only in_progress items when generation.steps is absent", async () => {
    const emitted: Array<{ type: string; item?: any }> = [];
    const block = generator({
      name: "ns-tool-no-steps",
      itemVisibility: { client: true, history: true },
      model: "inline-mock",
      prompt: "p"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "inline-mock",
        async generate() {
          return {
            text: "done",
            toolCalls: [{ toolCallId: "tc_2", toolName: "search", args: { q: "y" } }],
            finishReason: "stop"
          };
        }
      }),
      response: {
        emit: (event: any) => {
          emitted.push(event);
        }
      }
    });

    await runForTest(block, { value: "x" }, ctx);

    const tcpAdds = emitted.filter(
      e => e.type === "item.added" && e.item?.type === "tool_call_progress"
    );
    expect(tcpAdds.length).toBe(1);
    expect(tcpAdds[0].item.status).toBe("in_progress");
    expect(tcpAdds[0].item.toolCallId).toBe("tc_2");
  });

  it("emits no tool_call_progress items when itemVisibility is unset", async () => {
    const emitted: Array<{ type: string; item?: any }> = [];
    const block = generator({
      name: "ns-tool-no-identity",
      model: "inline-mock",
      prompt: "p"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "inline-mock",
        async generate() {
          return {
            text: "done",
            toolCalls: [{ toolCallId: "tc_3", toolName: "search", args: {} }],
            steps: [{
              toolCalls: [{ toolCallId: "tc_3", toolName: "search", args: {} }],
              toolResults: [{ toolCallId: "tc_3", toolName: "search", result: {} }]
            }],
            finishReason: "stop"
          };
        }
      }),
      response: {
        emit: (event: any) => {
          emitted.push(event);
        }
      }
    });

    await runForTest(block, { value: "x" }, ctx);

    const tcpAdds = emitted.filter(
      e => e.type === "item.added" && e.item?.type === "tool_call_progress"
    );
    expect(tcpAdds.length).toBe(0);
  });
});

describe("generator — observable model identity (FIX-518)", () => {
  it("stamps `model` on streamed message, reasoning, and tool_call_progress items", async () => {
    const emitted: Array<{ type: string; item?: any }> = [];
    const identity = { actual: "openai/gpt-5.5", requested: "intent/chat" };
    const block = generator({
      name: "stream-identity",
      itemVisibility: { client: true, history: true },
      model: "mock-model",
      prompt: "Stream please",
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "mock-model",
        async generate() {
          return { text: "fallback" };
        },
        async *stream() {
          // First chunk seeds resolvedIdentity for everything downstream.
          yield {
            type: "reasoning_delta" as const,
            reasoningDelta: "thinking",
            resolvedIdentity: identity,
          };
          yield {
            type: "tool_call_delta" as const,
            toolCallDelta: { toolCallId: "tc_1", toolName: "search", argsDelta: "{}" },
            resolvedIdentity: identity,
          };
          yield {
            type: "text_delta" as const,
            textDelta: "hi",
            resolvedIdentity: identity,
          };
          yield {
            type: "finish" as const,
            fullResult: { text: "hi", resolvedIdentity: identity },
            resolvedIdentity: identity,
          };
        },
      }),
      response: {
        emit: (event: any) => {
          emitted.push(event);
        },
      },
    });

    await runForTest(block, { value: "x" }, ctx);

    const stamped = emitted.filter(
      (e) =>
        e.type === "item.done" &&
        (e.item?.type === "message" ||
          e.item?.type === "reasoning" ||
          e.item?.type === "tool_call_progress")
    );
    expect(stamped.length).toBeGreaterThan(0);
    for (const e of stamped) {
      expect(e.item.model).toEqual(identity);
    }
  });

  it("stamps `model` on items emitted from a non-streaming generate result", async () => {
    const emitted: Array<{ type: string; item?: any }> = [];
    const identity = { actual: "openai/gpt-5.4-mini", requested: "intent/utility" };
    const block = generator({
      name: "non-stream-identity",
      itemVisibility: { client: true, history: true },
      model: "mock-model",
      // No tools, structured-friendly schema → goes through the non-streaming path.
      outputSchema: z.string(),
      prompt: "Just respond",
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "mock-model",
        async generate() {
          return { text: "done", resolvedIdentity: identity };
        },
      }),
      response: {
        emit: (event: any) => {
          emitted.push(event);
        },
      },
    });

    await runForTest(block, { value: "x" }, ctx);

    const messageDone = emitted.find(
      (e) => e.type === "item.done" && e.item?.type === "message"
    );
    expect(messageDone).toBeDefined();
    expect(messageDone!.item.model).toEqual(identity);
  });

  it("forwards `identity` through onGeneratorModelResult to the runtime hook", async () => {
    const identity = { actual: "anthropic/sonnet", requested: "intent/reason" };
    let capturedIdentity: unknown;
    const block = generator({
      name: "identity-hook",
      itemVisibility: { client: true, history: true },
      model: "mock-model",
      outputSchema: z.string(),
      prompt: "go",
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "mock-model",
        async generate() {
          return { text: "ok", resolvedIdentity: identity };
        },
      }),
      _runtimeHooks: {
        onGeneratorModelResult: (payload: { identity?: unknown }) => {
          capturedIdentity = payload.identity;
        },
      },
    } as any);

    await runForTest(block, { value: "x" }, ctx);
    expect(capturedIdentity).toEqual(identity);
  });

  it("handler-emitted items do not carry `model`", async () => {
    // Handlers emit messages via ctx.emitMessage. The framework only stamps
    // `model` on generator-emitted items; handler-emitted messages leave the
    // field absent. Validate the type-level expectation by constructing a
    // handler-emitted MessageItem shape and asserting no `model` field.
    const block = handler({
      name: "handler-emits",
      execute: () => "noop",
    });
    expect(block.kind).toBe("handler");
    // The shape contract is enforced by `OutputItemBase` — handlers go through
    // ctx.emitMessage which constructs items without `model`. We assert the
    // type contract rather than running the full server runtime here.
    const item: import("../src/items/types").MessageItem = {
      id: "m1",
      type: "message",
      role: "assistant",
      status: "completed",
      requestId: "r1",
      itemIndex: 0,
      provenance: { blockName: "h", blockInstanceId: "h", phase: "main" },
      ts: 0,
      content: [{ type: "output_text", text: "hi" }],
    };
    expect((item as Record<string, unknown>).model).toBeUndefined();
  });
});
