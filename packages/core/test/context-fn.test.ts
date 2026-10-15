import { describe, expect, it } from "vitest";
import { z } from "zod";
import { contextFn } from "../src/context";
import type { SessionScopeHandle, UserScopeHandle } from "../src/types/scope";
import { createMockContext, createStateOps } from "./helpers";

// Partial handles: contextFn reads `state`. The writers are the shared no-ops.
const stateOps = createStateOps<Record<string, unknown>>();
const mockSession = (state: Record<string, unknown>) =>
  ({ identity: { type: "session", id: "sess_1" }, state, ...stateOps }) as unknown as SessionScopeHandle;
const mockUser = (state: Record<string, unknown>) =>
  ({ identity: { type: "user", id: "user_1", userId: "user_1" }, state, ...stateOps }) as unknown as UserScopeHandle;

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
      session: mockSession({ topics: ["AI", "ML"], phase: "research" })
    });

    const result = fn(undefined, ctx);
    expect(result).toBe("Topics: AI, ML; Phase: research");
  });

  it("reads user state when schemas include user", () => {
    const fn = contextFn(
      { session: sessionStateSchema, user: userStateSchema },
      // @ts-expect-error — source bug FIX-2022: the session-only overload accepts `{ session, user }`, so `user` is missing on the callback.
      ({ session, user }) => `${user.role}: ${session.phase}`
    );

    const ctx = createMockContext({
      session: mockSession({ topics: [], phase: "active" }),
      user: mockUser({ role: "admin" })
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
      session: mockSession({ topics: [], phase: "done" })
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
      session: mockSession({ topics: [], phase: "init" })
    });

    expect(fn(undefined, ctx)).toBe("request: req_1");
  });
});
