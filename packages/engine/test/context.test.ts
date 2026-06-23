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

  it("applies token-based llm history limit using the active model (turn-aligned)", async () => {
    // Turn-aligned token packing: a whole request's messages fit or don't.
    // Both messages from the single prior request fit the 64-token budget,
    // so both are returned. (Under the old per-message budgeting this would
    // have returned only one — see FIX-608.)
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
          return messages.reduce(
            (sum, m) => sum + JSON.stringify(m.content ?? "").length,
            0
          );
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

    const messages = await ctx.session.items.history({ limit: { tokens: 64 } });
    expect(messages).toHaveLength(2);
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

// =============================================================================
// FIX-608: turn-aware history windowing
// =============================================================================

describe("loadLLMHistory — turn-aware windowing (FIX-608)", () => {
  type TurnSpec = {
    requestId: string;
    startedAtMs: number;
    userText?: string;
    assistantText?: string;
    /**
     * Number of synthetic tool calls in this turn. Each one produces a
     * `tool_output` item which `itemToLLMMessages` expands to one
     * assistant tool-call message + one tool tool-result message.
     */
    toolCalls?: number;
    /** Override item visibility for the assistant message. */
    assistantItemVisibility?: { client: boolean; history: boolean };
  };

  function makeTurn(spec: TurnSpec): any {
    const items: any[] = [];
    let itemIndex = 0;
    const baseTs = spec.startedAtMs * 1000;

    if (spec.userText !== undefined) {
      items.push({
        id: `${spec.requestId}_user`,
        type: "message",
        status: "completed",
        requestId: spec.requestId,
        itemIndex: itemIndex++,
        ts: baseTs + itemIndex,
        role: "user",
        itemVisibility: { client: true, history: true },
        content: [{ type: "output_text", text: spec.userText }],
        provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" }
      });
    }

    for (let k = 0; k < (spec.toolCalls ?? 0); k++) {
      items.push({
        id: `${spec.requestId}_tool_${k}`,
        type: "tool_output",
        status: "completed",
        requestId: spec.requestId,
        itemIndex: itemIndex++,
        ts: baseTs + itemIndex,
        itemVisibility: { client: true, history: true },
        toolCall: {
          callId: `call_${spec.requestId}_${k}`,
          name: `t_${k}`,
          alias: `t_${k}`,
          arguments: "{}"
        },
        output: "ok",
        provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" }
      });
    }

    if (spec.assistantText !== undefined) {
      items.push({
        id: `${spec.requestId}_assistant`,
        type: "message",
        status: "completed",
        requestId: spec.requestId,
        itemIndex: itemIndex++,
        ts: baseTs + itemIndex,
        role: "assistant",
        itemVisibility: spec.assistantItemVisibility ?? { client: true, history: true },
        content: [{ type: "output_text", text: spec.assistantText }],
        provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" }
      });
    }

    return {
      id: spec.requestId,
      flowKind: "fix608-flow",
      actionName: "run",
      sessionId: "sess",
      userId: "user_1",
      source: "http",
      status: "completed",
      startedAtMs: spec.startedAtMs,
      updatedAt: spec.startedAtMs,
      items
    };
  }

  async function makeCtx(
    turns: TurnSpec[],
    opts?: { tokenCounter?: any }
  ) {
    const block = handler<{ value: string }, { ok: boolean }>({
      name: "ctx-handler",
      execute: async (_input, ctx) => {
        ctx.resolveModel("openai/gpt-4o-mini", "ctx-handler");
        return { ok: true };
      }
    });

    const flow = defineFlow({
      kind: "fix608-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block
        }
      },
      tokenCounter: opts?.tokenCounter ?? {
        async count(text: string) {
          return text.length;
        },
        async countMessages(messages: any[]) {
          // Crude: 1 token per character of stringified content per message.
          return messages.reduce(
            (sum, m) => sum + JSON.stringify(m.content ?? "").length,
            0
          );
        }
      }
    })();

    const stores = createInMemoryStores();
    for (const t of turns) {
      const rec = makeTurn(t);
      await stores.request.set(rec.id, rec as any, "any");
    }

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_current",
      sessionId: "sess",
      userId: "user_1",
      stores
    });
    return ctx;
  }

  // Helper: pull text from a message-shaped LLMMessage
  function textOf(m: any): string {
    return typeof m.content === "string" ? m.content : "";
  }

  it("bare limit counts turns, not LLM messages — preserves prior user message after a tool-heavy turn (headline FIX-608 regression)", async () => {
    // Turn 1: short user/assistant. Turn 2: short user/assistant. Turn 3:
    // user + 4 tool calls + assistant. Under the OLD semantics a `limit: 8`
    // expanded to 8 raw messages and the 4 tool_outputs (= 8 protocol
    // messages) consumed the whole window, evicting the turn-2 user.
    const ctx = await makeCtx([
      { requestId: "r1", startedAtMs: 100, userText: "u1", assistantText: "a1" },
      { requestId: "r2", startedAtMs: 200, userText: "u2", assistantText: "a2" },
      { requestId: "r3", startedAtMs: 300, userText: "u3", toolCalls: 4, assistantText: "a3" }
    ]);

    const messages = await ctx.session.items.history({ limit: 8 });
    const texts = messages.map(textOf);

    // Turn 2's user message must still be present.
    expect(texts).toContain("u2");
    expect(texts).toContain("a2");
    expect(texts).toContain("u3");
    expect(texts).toContain("a3");
  });

  it("explicit { turns: 2 } drops the oldest turn", async () => {
    const ctx = await makeCtx([
      { requestId: "r1", startedAtMs: 100, userText: "u1", assistantText: "a1" },
      { requestId: "r2", startedAtMs: 200, userText: "u2", assistantText: "a2" },
      { requestId: "r3", startedAtMs: 300, userText: "u3", assistantText: "a3" }
    ]);

    const messages = await ctx.session.items.history({ limit: { turns: 2 } });
    const texts = messages.map(textOf);

    expect(texts).not.toContain("u1");
    expect(texts).not.toContain("a1");
    expect(texts).toEqual(["u2", "a2", "u3", "a3"]);
  });

  it("bare limit: N is equivalent to { turns: N }", async () => {
    const turns: TurnSpec[] = [
      { requestId: "r1", startedAtMs: 100, userText: "u1", assistantText: "a1" },
      { requestId: "r2", startedAtMs: 200, userText: "u2", assistantText: "a2" },
      { requestId: "r3", startedAtMs: 300, userText: "u3", toolCalls: 2, assistantText: "a3" }
    ];

    const ctxA = await makeCtx(turns);
    const a = await ctxA.session.items.history({ limit: 8 });

    const ctxB = await makeCtx(turns);
    const b = await ctxB.session.items.history({ limit: { turns: 8 } });

    expect(a).toEqual(b);
  });

  it("limit: { turns: 0 } returns no prior turns — guards Array.prototype.slice(-0)", async () => {
    // The critical guard: slice(-0) returns the whole array, not [].
    const ctx = await makeCtx([
      { requestId: "r1", startedAtMs: 100, userText: "u1", assistantText: "a1" },
      { requestId: "r2", startedAtMs: 200, userText: "u2", assistantText: "a2" }
    ]);

    const messages = await ctx.session.items.history({ limit: { turns: 0 } });
    expect(messages).toEqual([]);
  });

  it("bare limit: 0 returns no prior turns (same guard)", async () => {
    const ctx = await makeCtx([
      { requestId: "r1", startedAtMs: 100, userText: "u1", assistantText: "a1" }
    ]);

    const messages = await ctx.session.items.history({ limit: 0 });
    expect(messages).toEqual([]);
  });

  it("limit greater than available turns returns all turns (no off-by-one)", async () => {
    const ctx = await makeCtx([
      { requestId: "r1", startedAtMs: 100, userText: "u1", assistantText: "a1" },
      { requestId: "r2", startedAtMs: 200, userText: "u2", assistantText: "a2" },
      { requestId: "r3", startedAtMs: 300, userText: "u3", assistantText: "a3" }
    ]);

    const messages = await ctx.session.items.history({ limit: { turns: 8 } });
    expect(messages.map(textOf)).toEqual(["u1", "a1", "u2", "a2", "u3", "a3"]);
  });

  it("token-based limit packs whole turns from the end and never splits a turn", async () => {
    // Each user/assistant text chosen so that JSON.stringify-based counter
    // makes turn token costs deterministic:
    //   "u1"=4, "a1"=4 → turn1 ≈ 8
    //   "u2"=4, "a2"=4 → turn2 ≈ 8
    //   "u3"=4, "a3"=4 → turn3 ≈ 8
    const ctx = await makeCtx([
      { requestId: "r1", startedAtMs: 100, userText: "u1", assistantText: "a1" },
      { requestId: "r2", startedAtMs: 200, userText: "u2", assistantText: "a2" },
      { requestId: "r3", startedAtMs: 300, userText: "u3", assistantText: "a3" }
    ]);

    // Budget of 20 fits 2 whole turns (16 chars), not 3 (24 chars). Third
    // turn from end (= turn 1) must not split.
    const messages = await ctx.session.items.history({ limit: { tokens: 20 } });
    expect(messages.map(textOf)).toEqual(["u2", "a2", "u3", "a3"]);
  });

  it("token-based limit always includes the most recent turn even if it alone exceeds the budget", async () => {
    const ctx = await makeCtx([
      { requestId: "r1", startedAtMs: 100, userText: "u1", assistantText: "a1" },
      { requestId: "r2", startedAtMs: 200, userText: "supersized user message that on its own overflows the budget", assistantText: "supersized assistant reply that on its own overflows the budget too" }
    ]);

    const messages = await ctx.session.items.history({ limit: { tokens: 5 } });
    // Latest turn alone is included; older turn is dropped.
    expect(messages).toHaveLength(2);
    expect(textOf(messages[0])).toContain("supersized user");
    expect(textOf(messages[1])).toContain("supersized assistant");
  });

  it("token-based limit: tokens: 0 still includes the latest turn (most-recent-turn exception)", async () => {
    const ctx = await makeCtx([
      { requestId: "r1", startedAtMs: 100, userText: "u1", assistantText: "a1" },
      { requestId: "r2", startedAtMs: 200, userText: "u2", assistantText: "a2" }
    ]);

    const messages = await ctx.session.items.history({ limit: { tokens: 0 } });
    expect(messages.map(textOf)).toEqual(["u2", "a2"]);
  });

  it("sub-agent items in a retained turn are filtered out by resolveItemVisibility", async () => {
    // The assistant message in turn 1 is sub-agent — history: false.
    const ctx = await makeCtx([
      { requestId: "r1", startedAtMs: 100, userText: "u1", assistantText: "a1", assistantItemVisibility: { client: true, history: false } },
      { requestId: "r2", startedAtMs: 200, userText: "u2", assistantText: "a2" }
    ]);

    const messages = await ctx.session.items.history({ limit: { turns: 8 } });
    const texts = messages.map(textOf);
    // user messages remain (FIX-389 user-message visibility), but the
    // sub-agent assistant message is dropped.
    expect(texts).not.toContain("a1");
    expect(texts).toContain("u1");
    expect(texts).toContain("u2");
    expect(texts).toContain("a2");
  });

  it("undefined limit returns all prior turns", async () => {
    const ctx = await makeCtx([
      { requestId: "r1", startedAtMs: 100, userText: "u1", assistantText: "a1" },
      { requestId: "r2", startedAtMs: 200, userText: "u2", assistantText: "a2" }
    ]);

    const messages = await ctx.session.items.history();
    expect(messages.map(textOf)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("tool-call/result messages inside a retained turn are preserved full-fidelity", async () => {
    const ctx = await makeCtx([
      { requestId: "r1", startedAtMs: 100, userText: "u1", toolCalls: 2, assistantText: "a1" }
    ]);

    const messages = await ctx.session.items.history({ limit: { turns: 1 } });

    // Expect: user, [assistant tool-call, tool tool-result] x 2, assistant
    expect(messages).toHaveLength(1 + 2 * 2 + 1);
    expect((messages[0] as any).role).toBe("user");
    expect((messages[1] as any).role).toBe("assistant");
    expect((messages[2] as any).role).toBe("tool");
    expect((messages[3] as any).role).toBe("assistant");
    expect((messages[4] as any).role).toBe("tool");
    expect((messages[5] as any).role).toBe("assistant");
    expect(textOf(messages[5])).toBe("a1");
  });
});
