import { defineFlow, defineResource, handler } from "@flow-state-dev/core";
import type { ModelResolver, GeneratorModel } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createExecutionContext,
  createInMemoryStores
} from "../src";

function createStubModelResolver(): ModelResolver {
  const resolver = ((modelId: string): GeneratorModel => ({
    modelId,
    generate: async () => ({
      text: `stub response from ${modelId}`,
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }),
  })) as ModelResolver;
  resolver.resolveId = (modelId: string) => modelId;
  return resolver;
}

function createFlow() {
  const block = handler<{ value: string }, { ok: boolean }>({
    name: "ctx-handler",
    execute: () => ({ ok: true })
  });

  return defineFlow({
    kind: "ctx-flow",
    actions: {
      run: {
        inputSchema: z.object({ value: z.string() }),
        block
      }
    }
  })();
}

describe("createExecutionContext", () => {
  it("enforces user requirement", async () => {
    const flow = createFlow();
    const stores = createInMemoryStores();

    await expect(
      createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_user_missing",
        sessionId: "sess_user_missing",
        stores
      })
    ).rejects.toThrow("requires a userId");
  });

  it("composes request/session/user scopes and persists state updates", async () => {
    const flow = createFlow();
    const stores = createInMemoryStores();

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_1",
      sessionId: "sess_1",
      userId: "user_1",
      stores,
      modelResolver: createStubModelResolver(),
      requestState: { count: 0 },
      sessionState: { mode: "chat" },
      userState: { role: "member" }
    });

    expect(ctx.request.identity.type).toBe("request");
    expect(ctx.user.identity.type).toBe("user");
    expect(ctx.session.identity.type).toBe("session");
    expect(ctx.org).toBeUndefined();

    await ctx.request.patchState({ count: 2 });
    await ctx.user.patchState({ role: "admin" });
    await ctx.session.appendJournal({ text: "started", source: "test" });

    const savedRequest = await stores.request.get("req_1");
    const savedUser = await stores.user.get("user_1");
    const savedSession = await stores.session.get("sess_1");

    expect(savedRequest?.state).toEqual({ count: 2 });
    expect(savedUser?.state).toEqual({ role: "admin" });
    expect(savedSession?.journal.length).toBe(1);
    expect(await ctx.session.getJournal()).toHaveLength(1);
    const model = ctx.resolveModel("openai/gpt-4o-mini", "ctx-handler");
    expect(model.modelId).toBe("openai/gpt-4o-mini");
    expect(typeof model.generate).toBe("function");
  });

  it("creates an ephemeral session when no sessionId is provided", async () => {
    const flow = createFlow();
    const stores = createInMemoryStores();

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_no_session",
      userId: "user_no_session",
      stores
    });

    expect(ctx.session).toBeDefined();
    expect(ctx.session.identity.type).toBe("session");
    expect(ctx.user.identity.id).toBe("user_no_session");
  });

  it("applies token-based llm history limit using the active model", async () => {
    const block = handler<{ value: string }, { ok: boolean }>({
      name: "ctx-handler",
      execute: async (_input, ctx) => {
        ctx.resolveModel("openai/gpt-4o-mini", "ctx-handler");
        return { ok: true };
      }
    });

    const flow = defineFlow({
      kind: "ctx-flow-token-limit",
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block
        }
      },
      tokenCounter: {
        async count(text: string) {
          return text.length;
        },
        async countMessages(messages) {
          return JSON.stringify(messages[0]?.content ?? "").length;
        }
      }
    })();

    const stores = createInMemoryStores();
    await stores.request.set("req_prev", {
      id: "req_prev",
      flowKind: flow.kind,
      actionName: "run",
      sessionId: "sess_token",
      userId: "user_token",
      status: "completed",
      startedAtMs: 1,
      updatedAt: 1,
      items: [
        {
          id: "item1",
          type: "message",
          status: "completed",
          requestId: "req_prev",
          itemIndex: 0,
          ts: 1,
          role: "user",
          content: [{ type: "output_text", text: "short" }],
          provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" }
        } as any,
        {
          id: "item2",
          type: "message",
          status: "completed",
          requestId: "req_prev",
          itemIndex: 1,
          ts: 2,
          role: "assistant",
          content: [{ type: "output_text", text: "this is a longer message" }],
          provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" }
        } as any
      ]
    } as any, "any");

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_cur",
      sessionId: "sess_token",
      userId: "user_token",
      stores
    });

    const messages = await ctx.session.items.history({ limit: { tokens: 28 } });
    expect(messages).toHaveLength(1);
  });

  it("supports resource definition-time content with rendering", async () => {
    const flow = defineFlow({
      kind: "resource-content-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: handler({
            name: "noop",
            inputSchema: z.object({ value: z.string() }),
            outputSchema: z.object({ ok: z.boolean() }),
            execute: () => ({ ok: true })
          })
        }
      },
      resources: {
        soul: defineResource({
          scope: "session",
          stateSchema: z.object({ values: z.array(z.string()).default([]), tone: z.string().default("Direct") }),
          content: "## Values\n{{#each values}}- {{this}}\n{{/each}}Tone: {{tone}}",
          render: (content, state) => content
            .replace("{{#each values}}", "")
            .replace("{{/each}}", "")
            .replace("{{this}}", (state.values as string[])[0] ?? "")
            .replace("{{tone}}", String(state.tone ?? ""))
        })
      }
    })();

    const stores = createInMemoryStores();
    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_content",
      sessionId: "sess_content",
      userId: "user_content",
      stores
    });

    await ctx.resources.soul.patchState({ values: ["Honesty"], tone: "Calm" });
    await expect(ctx.resources.soul.readContent()).resolves.toContain("Tone: Calm");
    await expect(ctx.resources.soul.readContentRaw()).resolves.toContain("{{tone}}");
  });

  it("returns null from readContent when no resource content is defined", async () => {
    const flow = defineFlow({
      kind: "resource-empty-content-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: handler({ name: "noop", execute: () => ({ ok: true }) })
        }
      },
      resources: {
        notes: defineResource({
          scope: "session",
          stateSchema: z.object({ value: z.string().default("") })
        })
      }
    })();

    const stores = createInMemoryStores();
    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_null_content",
      sessionId: "sess_null_content",
      userId: "user_null_content",
      stores
    });

    await expect(ctx.resources.notes.readContent()).resolves.toBeNull();
    await expect(ctx.resources.notes.readContentRaw()).resolves.toBeNull();
  });

  it("throws when writeContent is called on a read-only resource", async () => {
    const block = handler<{ msg: string }, { ok: boolean }>({
      name: "readonly-content-handler",
      execute: () => ({ ok: true })
    });

    const flow = defineFlow({
      kind: "readonly-content-flow",
      actions: {
        run: {
          inputSchema: z.object({ msg: z.string() }),
          block
        }
      },
      session: {
        stateSchema: z.object({})
      },
      resources: {
        readme: defineResource({
          scope: "session",
          stateSchema: z.object({}),
          content: "original content",
          writable: false
        })
      }
    })();

    const stores = createInMemoryStores();
    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_readonly_content",
      sessionId: "sess_readonly_content",
      userId: "user_readonly_content",
      stores
    });

    await expect(
      ctx.resources.readme.writeContent("new content")
    ).rejects.toThrow("read-only");
  });

  it("replays block_tool_output items using the stored alias for tool-call/tool-result toolName", async () => {
    // The model only ever saw the sanitised alias (e.g. `tf_memory_recall`).
    // History replay must rebuild the tool-call / tool-result content parts
    // with that same string so OpenAI's `^[a-zA-Z0-9_-]+$` rule passes on
    // the next turn. Items written by the new emit path carry the alias
    // explicitly; items persisted before the field existed fall back to
    // sanitising the framework name.
    const flow = createFlow();
    const stores = createInMemoryStores();

    await stores.request.set("req_tool_prev", {
      id: "req_tool_prev",
      flowKind: flow.kind,
      actionName: "run",
      sessionId: "sess_tool_replay",
      userId: "user_tool_replay",
      status: "completed",
      startedAtMs: 1,
      updatedAt: 1,
      items: [
        {
          id: "item_user",
          type: "message",
          status: "completed",
          requestId: "req_tool_prev",
          itemIndex: 0,
          ts: 1,
          role: "user",
          content: [{ type: "output_text", text: "what's my wife's name?" }],
          provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" }
        } as any,
        // New item — alias populated at emit time.
        {
          id: "item_tool_new",
          type: "tool_output",
          status: "completed",
          requestId: "req_tool_prev",
          itemIndex: 1,
          ts: 2,
          blockName: "tf.memory/recall",
          output: '{"results":["Moni"]}',
          toolCall: {
            callId: "call_new",
            name: "tf.memory/recall",
            alias: "tf_memory_recall",
            arguments: '{"query":"wife"}',
            generatorBlock: "asst-gen"
          },
          provenance: { blockName: "tf.memory/recall", blockInstanceId: "tf.memory/recall", phase: "main" }
        } as any,
        // Legacy item — no alias field; fallback derives it from `name`.
        {
          id: "item_tool_legacy",
          type: "tool_output",
          status: "completed",
          requestId: "req_tool_prev",
          itemIndex: 2,
          ts: 3,
          blockName: "tf.memory/recall",
          output: '{"results":["Moni"]}',
          toolCall: {
            callId: "call_legacy",
            name: "tf.memory/recall",
            arguments: '{"query":"wife"}',
            generatorBlock: "asst-gen"
          },
          provenance: { blockName: "tf.memory/recall", blockInstanceId: "tf.memory/recall", phase: "main" }
        } as any
      ]
    } as any, "any");

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_tool_cur",
      sessionId: "sess_tool_replay",
      userId: "user_tool_replay",
      stores
    });

    const messages = await ctx.session.items.history();
    // Each block_tool_output expands to an assistant tool-call + tool-result
    // pair, so we expect: 1 user + 2 * (assistant + tool) = 5 messages.
    expect(messages).toHaveLength(5);

    const toolCallNames = messages
      .flatMap((m: any) => (Array.isArray(m.content) ? m.content : []))
      .filter((c: any) => c?.type === "tool-call" || c?.type === "tool-result")
      .map((c: any) => c.toolName);

    // Both the new item and the legacy item end up with the sanitised name
    // — the new item via the stored alias, the legacy item via the fallback.
    expect(toolCallNames).toEqual([
      "tf_memory_recall",
      "tf_memory_recall",
      "tf_memory_recall",
      "tf_memory_recall"
    ]);
    // Defence: nothing leaks the framework name with `.` / `/` into a part
    // that the model would see.
    for (const name of toolCallNames) {
      expect(name).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });

});
