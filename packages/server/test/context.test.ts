import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createExecutionContext,
  createInMemoryStores
} from "../src";

function createFlow(requireSession = true) {
  const block = handler<{ value: string }, { ok: boolean }>({
    name: "ctx-handler",
    execute: () => ({ ok: true })
  });

  return defineFlow({
    kind: "ctx-flow",
    requireSession,
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
    const flow = createFlow(true);
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
    const flow = createFlow(true);
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
    expect(ctx.session?.identity.type).toBe("session");
    expect(ctx.project).toBeUndefined();

    await ctx.request.patchState({ count: 2 });
    await ctx.user.patchState({ role: "admin" });
    await ctx.session?.appendJournal({ text: "started", source: "test" });

    const savedRequest = await stores.request.get("req_1");
    const savedUser = await stores.user.get("user_1");
    const savedSession = await stores.session.get("sess_1");

    expect(savedRequest?.state).toEqual({ count: 2 });
    expect(savedUser?.state).toEqual({ role: "admin" });
    expect(savedSession?.journal.length).toBe(1);
    expect(await ctx.session?.getJournal()).toHaveLength(1);
    const model = ctx.resolveModel("openai:gpt-4o-mini", "ctx-handler");
    expect(model.modelId).toBe("openai:gpt-4o-mini");
    expect(typeof model.generate).toBe("function");
  });

  it("supports flows that opt out of sessions", async () => {
    const flow = createFlow(false);
    const stores = createInMemoryStores();

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_no_session",
      userId: "user_no_session",
      stores
    });

    expect(ctx.session).toBeUndefined();
    expect(ctx.user.identity.id).toBe("user_no_session");
  });
});
