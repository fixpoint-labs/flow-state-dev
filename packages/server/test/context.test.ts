import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createExecutionContext,
  createInMemoryStores
} from "../src";

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
      requestState: { count: 0 },
      sessionState: { mode: "chat" },
      userState: { role: "member" }
    });

    expect(ctx.request.identity.type).toBe("request");
    expect(ctx.user.identity.type).toBe("user");
    expect(ctx.session.identity.type).toBe("session");
    expect(ctx.project).toBeUndefined();

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
    const model = ctx.resolveModel("openai:gpt-4o-mini", "ctx-handler");
    expect(model.modelId).toBe("openai:gpt-4o-mini");
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
        ctx.resolveModel("openai:gpt-4o-mini", "ctx-handler");
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
    } as any);

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_cur",
      sessionId: "sess_token",
      userId: "user_token",
      stores
    });

    const messages = await ctx.session.items.llm({ limit: { tokens: 28 } });
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
      session: {
        resources: {
          soul: {
            stateSchema: z.object({ values: z.array(z.string()).default([]), tone: z.string().default("Direct") }),
            content: "## Values\n{{#each values}}- {{this}}\n{{/each}}Tone: {{tone}}",
            render: (content, state) => content
              .replace("{{#each values}}", "")
              .replace("{{/each}}", "")
              .replace("{{this}}", (state.values as string[])[0] ?? "")
              .replace("{{tone}}", String(state.tone ?? ""))
          }
        }
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

    await ctx.session.resources.soul.patchState({ values: ["Honesty"], tone: "Calm" });
    await expect(ctx.session.resources.soul.readContent()).resolves.toContain("Tone: Calm");
    await expect(ctx.session.resources.soul.readContentRaw()).resolves.toContain("{{tone}}");
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
      session: {
        resources: {
          notes: {
            stateSchema: z.object({ value: z.string().default("") })
          }
        }
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

    await expect(ctx.session.resources.notes.readContent()).resolves.toBeNull();
    await expect(ctx.session.resources.notes.readContentRaw()).resolves.toBeNull();
  });

});
