import { describe, expect, it } from "vitest";
import { z } from "zod";
import { contextFn } from "../src/context";
import type { SessionScopeHandle, UserScopeHandle } from "../src/types/scope";
import { createMockContext } from "./helpers";

// contextFn reads only `state` off a scope handle, so these are partial
// handles: the state, an identity, and no-op writers.
const stateOps = {
  patchState: async () => true,
  setState: async () => true,
  incState: async () => true,
  pushState: async () => true,
  setStateRecord: async () => true,
  deleteStateRecord: async () => true,
  atomicState: async () => true
};
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
      // @ts-expect-error — source bug, to be filed (found by FIX-1343): contextFn's session-only
      // overload is tried first and accepts `{ session, user }`, so the session+user overload is
      // unreachable and `user` is missing from the callback's type. Remove once that is fixed.
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
