/**
 * FIX-428: binding-immutability tests for createExecutionContext.
 *
 * Two long-standing gaps motivate these tests:
 *
 *   1. `userId` mismatch silently succeeded — the loaded session record's
 *      userId was preserved without cross-checking the incoming options.userId.
 *      A caller could pass userId=alice for a session created with userId=bob
 *      and route bob's data into alice's response.
 *
 *   2. `orgId` rebinding silently succeeded — the previous code used
 *      `optionsOrgId ?? sessionRecord.orgId`, letting any caller-supplied
 *      orgId override the session's stored value on every request. This
 *      vacated FIX-428's "immutable binding" guarantee.
 *
 * Both gaps are now closed by checks just past the loaded-session branch in
 * createExecutionContext. These tests cover both gaps plus the late-bind case
 * (per spec §10.2 we throw rather than silently ignore).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import {
  createExecutionContext,
  createInMemoryStores,
  OrgBindingMismatchError,
  UserBindingMismatchError
} from "../src";

function createTestFlow() {
  return defineFlow({
    kind: "binding-flow",
    actions: {
      run: {
        inputSchema: z.object({ value: z.string() }),
        block: handler<{ value: string }, { ok: boolean }>({
          name: "binding-handler",
          execute: () => ({ ok: true })
        })
      }
    }
  })();
}

describe("createExecutionContext binding immutability", () => {
  describe("userId mismatch", () => {
    it("rejects a request that claims a different userId than the session was created with", async () => {
      const flow = createTestFlow();
      const stores = createInMemoryStores();

      // Create session as user "alice".
      await createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_init",
        sessionId: "sess_user_mismatch",
        userId: "alice",
        stores
      });

      // Subsequent request claims user "bob" — must throw.
      await expect(
        createExecutionContext({
          flow,
          actionName: "run",
          requestId: "req_bob_attempt",
          sessionId: "sess_user_mismatch",
          userId: "bob",
          stores
        })
      ).rejects.toBeInstanceOf(UserBindingMismatchError);
    });

    it("accepts a request that supplies the correct userId for an existing session", async () => {
      const flow = createTestFlow();
      const stores = createInMemoryStores();

      await createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_init",
        sessionId: "sess_user_match",
        userId: "alice",
        stores
      });

      const ctx = await createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_repeat",
        sessionId: "sess_user_match",
        userId: "alice",
        stores
      });
      expect(ctx.user.identity.id).toBe("alice");
    });
  });

  describe("orgId immutability", () => {
    it("rejects a request that supplies a different orgId than the session was bound to", async () => {
      const flow = createTestFlow();
      const stores = createInMemoryStores();

      await createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_init",
        sessionId: "sess_org_mismatch",
        userId: "alice",
        orgId: "org_a",
        stores
      });

      await expect(
        createExecutionContext({
          flow,
          actionName: "run",
          requestId: "req_steal",
          sessionId: "sess_org_mismatch",
          userId: "alice",
          orgId: "org_b",
          stores
        })
      ).rejects.toBeInstanceOf(OrgBindingMismatchError);
    });

    it("rejects late-binding an unbound session with an orgId", async () => {
      // Per spec §10.2: late-bind is rejected. Apps that need to bind a session
      // create a new one; partial binding mid-conversation is too easy to abuse.
      const flow = createTestFlow();
      const stores = createInMemoryStores();

      await createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_init",
        sessionId: "sess_org_late",
        userId: "alice",
        stores
      });

      await expect(
        createExecutionContext({
          flow,
          actionName: "run",
          requestId: "req_late_bind",
          sessionId: "sess_org_late",
          userId: "alice",
          orgId: "org_late",
          stores
        })
      ).rejects.toBeInstanceOf(OrgBindingMismatchError);
    });

    it("accepts a request with a matching orgId", async () => {
      const flow = createTestFlow();
      const stores = createInMemoryStores();

      await createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_init",
        sessionId: "sess_org_match",
        userId: "alice",
        orgId: "org_a",
        stores
      });

      const ctx = await createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_repeat",
        sessionId: "sess_org_match",
        userId: "alice",
        orgId: "org_a",
        stores
      });
      expect(ctx.org?.identity.id).toBe("org_a");
    });

    it("accepts a request that omits orgId for an org-bound session (uses stored value)", async () => {
      const flow = createTestFlow();
      const stores = createInMemoryStores();

      await createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_init",
        sessionId: "sess_org_omit",
        userId: "alice",
        orgId: "org_a",
        stores
      });

      const ctx = await createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_omit",
        sessionId: "sess_org_omit",
        userId: "alice",
        stores
      });
      expect(ctx.org?.identity.id).toBe("org_a");
    });
  });

  it("userId mismatch is checked before orgId mismatch", async () => {
    const flow = createTestFlow();
    const stores = createInMemoryStores();

    await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_init",
      sessionId: "sess_both_mismatch",
      userId: "alice",
      orgId: "org_a",
      stores
    });

    // Both userId and orgId are wrong — userId check fires first.
    await expect(
      createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_both",
        sessionId: "sess_both_mismatch",
        userId: "bob",
        orgId: "org_b",
        stores
      })
    ).rejects.toBeInstanceOf(UserBindingMismatchError);
  });
});
