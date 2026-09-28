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
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import {
  createExecutionContext,
  createInMemoryStores,
  createResponseEmitter,
  OrgBindingMismatchError,
  runAction,
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
    orgId: DEFAULT_ORG_ID,
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
    orgId: DEFAULT_ORG_ID,
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
    orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "run",
        requestId: "req_init",
        sessionId: "sess_user_match",
        userId: "alice",
        stores
      });

      const ctx = await createExecutionContext({
    orgId: DEFAULT_ORG_ID,
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
    orgId: DEFAULT_ORG_ID,
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

    it("refuses a later request that names a different organization than the session's", async () => {
      // This replaces "accepts a request that omits orgId (uses stored value)".
      // A request can no longer omit the organization (FIX-1442), so the case
      // that test described does not exist: what used to arrive as an absence
      // now arrives as a different, concrete organization — most often the
      // development default, from a caller that was never migrated. Reading the
      // stored value would silently run it under `org_a` anyway, which is the
      // immutability guarantee inverted: the binding would be deciding who the
      // caller is instead of being checked against them.
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

      await expect(
        createExecutionContext({
          flow,
          actionName: "run",
          requestId: "req_omit",
          sessionId: "sess_org_omit",
          userId: "alice",
          orgId: DEFAULT_ORG_ID,
          stores
        })
      ).rejects.toThrow(/org_a/);
    });

    it("still admits a later request that names the session's own organization", async () => {
      const flow = createTestFlow();
      const stores = createInMemoryStores();

      await createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_init",
        sessionId: "sess_org_same",
        userId: "alice",
        orgId: "org_a",
        stores
      });

      const ctx = await createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_same",
        sessionId: "sess_org_same",
        userId: "alice",
        orgId: "org_a",
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

describe("a refused request and the session's latest request", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // `runAction` records the newest request on the session (the pointer a
  // client uses to resume a stream) before `createExecutionContext` checks the
  // caller. A request the check then refuses must not have moved that pointer,
  // or its owner would resume onto a run that was never theirs to see.
  async function send(
    stores: ReturnType<typeof createInMemoryStores>,
    requestId: string,
    who: { userId: string; orgId: string }
  ): Promise<void> {
    await runAction({
      ...who,
      flow: createTestFlow(),
      actionName: "run",
      input: { value: "x" },
      sessionId: "sess_latest",
      requestId,
      stores,
      responseEmitter: createResponseEmitter({ requestId }),
      runtimeConfig: {}
    });
  }

  it.each([
    ["another user", { userId: "bob", orgId: "org_a" }, UserBindingMismatchError],
    ["its owner acting for another organization", { userId: "alice", orgId: "org_b" }, OrgBindingMismatchError]
  ])("keeps it when the request comes from %s", async (_label, who, refusal) => {
    const stores = createInMemoryStores();
    // The first request creates the session; the pointer is set from the second.
    await send(stores, "req_first", { userId: "alice", orgId: "org_a" });
    await send(stores, "req_owner", { userId: "alice", orgId: "org_a" });
    const before = await stores.session.get("sess_latest");
    expect(before?.latestRequestId).toBe("req_owner");

    await expect(send(stores, "req_refused", who)).rejects.toBeInstanceOf(refusal);

    const after = await stores.session.get("sess_latest");
    expect(after?.latestRequestId).toBe("req_owner");
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  // The session is read when the request is admitted and again when the
  // pointer is written. A session that takes the id in between is another
  // one, which the request was never admitted to, whoever it belongs to.
  it.each([
    ["created again under another flow instance", { flowKind: "notes-flow", flowId: "notes-flow" }],
    ["deleted and created again by its owner", { lineageId: "lin_again", createdAt: 1 }]
  ] as const)("keeps it when the session is %s between the request's admission and the write", async (_what, again) => {
    const stores = createInMemoryStores();
    await send(stores, "req_first", { userId: "alice", orgId: "org_a" });
    await send(stores, "req_owner", { userId: "alice", orgId: "org_a" });
    const before = (await stores.session.get("sess_latest"))!;

    const get = stores.session.get.bind(stores.session);
    let replaced = false;
    vi.spyOn(stores.session, "get").mockImplementation(async (id) => {
      const found = await get(id);
      if (!replaced && id === "sess_latest") {
        // Admission has its copy; the id now holds another session.
        replaced = true;
        await stores.session.delete(id);
        await stores.session.set(id, { ...before, ...again }, "any");
      }
      return found;
    });

    await send(stores, "req_next", { userId: "alice", orgId: "org_a" }).catch(() => {});
    expect(replaced).toBe(true);
    expect((await get("sess_latest"))?.latestRequestId).toBe("req_owner");
  });

  // Admission found no session, so it checked none. One that arrives before
  // the write is judged there as admission would have judged it.
  it("keeps it on a session of another flow instance that arrived after admission found none", async () => {
    const stores = createInMemoryStores();
    const get = stores.session.get.bind(stores.session);
    let arrived = false;
    vi.spyOn(stores.session, "get").mockImplementation(async (id) => {
      const found = await get(id);
      if (!arrived && id === "sess_latest") {
        arrived = true;
        await stores.session.set(
          id,
          {
            id,
            flowKind: "notes-flow",
            flowId: "notes-flow",
            userId: "alice",
            orgId: "org_a",
            state: {},
            version: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            latestRequestId: "req_theirs",
            journal: []
          },
          "any"
        );
      }
      return found;
    });

    await send(stores, "req_next", { userId: "alice", orgId: "org_a" }).catch(() => {});
    expect(arrived).toBe(true);
    expect((await get("sess_latest"))?.latestRequestId).toBe("req_theirs");
  });
});
