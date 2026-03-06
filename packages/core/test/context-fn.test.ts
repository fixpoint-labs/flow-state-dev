import { describe, expect, it } from "vitest";
import { z } from "zod";
import { contextFn } from "../src/context";
import { createMockContext } from "./helpers";

describe("contextFn", () => {
  const sessionStateSchema = z.object({
    topics: z.array(z.string()),
    phase: z.string()
  });

  const userStateSchema = z.object({
    role: z.enum(["admin", "member"])
  });

  it("reads session state and passes it to the callback", () => {
    const fn = contextFn(
      { session: sessionStateSchema },
      ({ session }) => `Topics: ${session.topics.join(", ")}; Phase: ${session.phase}`
    );

    const ctx = createMockContext({
      session: {
        identity: { type: "session", id: "sess_1" },
        state: { topics: ["AI", "ML"], phase: "research" },
        resources: { get: () => { throw new Error("no resources"); }, list: () => [] } as any,
        items: { all: () => [], client: () => [], llm: async () => [] },
        appendJournal: async () => undefined,
        getJournal: async () => [],
        patchState: async () => undefined,
        setState: async () => undefined,
        incState: async () => undefined,
        pushState: async () => undefined,
        setStateRecord: async () => undefined,
        deleteStateRecord: async () => undefined,
        atomicState: async () => undefined
      }
    });

    const result = fn(undefined, ctx);
    expect(result).toBe("Topics: AI, ML; Phase: research");
  });

  it("reads user state when schemas include user", () => {
    const fn = contextFn(
      { session: sessionStateSchema, user: userStateSchema },
      ({ session, user }) => `${user.role}: ${session.phase}`
    );

    const ctx = createMockContext({
      session: {
        identity: { type: "session", id: "sess_1" },
        state: { topics: [], phase: "active" },
        resources: { get: () => { throw new Error("no resources"); }, list: () => [] } as any,
        items: { all: () => [], client: () => [], llm: async () => [] },
        appendJournal: async () => undefined,
        getJournal: async () => [],
        patchState: async () => undefined,
        setState: async () => undefined,
        incState: async () => undefined,
        pushState: async () => undefined,
        setStateRecord: async () => undefined,
        deleteStateRecord: async () => undefined,
        atomicState: async () => undefined
      },
      user: {
        identity: { type: "user", id: "user_1", userId: "user_1" },
        state: { role: "admin" },
        resources: { get: () => { throw new Error("no resources"); }, list: () => [] } as any,
        patchState: async () => undefined,
        setState: async () => undefined,
        incState: async () => undefined,
        pushState: async () => undefined,
        setStateRecord: async () => undefined,
        deleteStateRecord: async () => undefined,
        atomicState: async () => undefined
      }
    });

    const result = fn({}, ctx);
    expect(result).toBe("admin: active");
  });

  it("ignores the input parameter (input is for generator slot compatibility)", () => {
    const fn = contextFn(
      { session: sessionStateSchema },
      ({ session }) => session.phase
    );

    const ctx = createMockContext({
      session: {
        identity: { type: "session", id: "sess_1" },
        state: { topics: [], phase: "done" },
        resources: { get: () => { throw new Error("no resources"); }, list: () => [] } as any,
        items: { all: () => [], client: () => [], llm: async () => [] },
        appendJournal: async () => undefined,
        getJournal: async () => [],
        patchState: async () => undefined,
        setState: async () => undefined,
        incState: async () => undefined,
        pushState: async () => undefined,
        setStateRecord: async () => undefined,
        deleteStateRecord: async () => undefined,
        atomicState: async () => undefined
      }
    });

    // Different inputs should not change the result
    expect(fn("anything", ctx)).toBe("done");
    expect(fn({ prompt: "hello" }, ctx)).toBe("done");
    expect(fn(undefined, ctx)).toBe("done");
  });

  it("passes ctx to callback for advanced use cases", () => {
    const fn = contextFn(
      { session: sessionStateSchema },
      (_scopes, ctx) => `request: ${ctx.request.identity.id}`
    );

    const ctx = createMockContext({
      session: {
        identity: { type: "session", id: "sess_1" },
        state: { topics: [], phase: "init" },
        resources: { get: () => { throw new Error("no resources"); }, list: () => [] } as any,
        items: { all: () => [], client: () => [], llm: async () => [] },
        appendJournal: async () => undefined,
        getJournal: async () => [],
        patchState: async () => undefined,
        setState: async () => undefined,
        incState: async () => undefined,
        pushState: async () => undefined,
        setStateRecord: async () => undefined,
        deleteStateRecord: async () => undefined,
        atomicState: async () => undefined
      }
    });

    expect(fn(undefined, ctx)).toBe("request: req_1");
  });
});
