/**
 * A block's admission to a session it names: the routes' own admission, fed
 * the run's resolved principal.
 *
 * Why these matter: a block that can name any session id is a door to every
 * conversation in the store. It must admit exactly what the HTTP routes admit
 * the same person, and every refusal must read as an unknown id, or a caller
 * learns which ids exist. Each refusal case below is compared with the answer
 * for an id nobody holds.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowRegistry } from "../../src";
import { createInMemoryStores } from "../../src/host";
import { admitNamedSession, principalOwnsNothing, type BlockCaller } from "../../src/context/named-session";
import { resolveSessionStorageKey } from "../../src/stores/scope-keys";

const ORG = "acme";

const run = handler({ name: "run", inputSchema: z.object({}), outputSchema: z.object({}), execute: () => ({}) });

/** A flow that takes its identity from the framework default resolver. */
const openFlow = (kind: string) => defineFlow({ kind, actions: { run } })();

/** A flow with a resolver of its own: a verified-header stand-in. */
const secureFlow = (kind: string) =>
  defineFlow({
    kind,
    actions: { run },
    authentication: {
      resolvePrincipal: (context) => {
        const user = context.request?.headers.get("x-verified-user");
        return user === null || user === undefined ? null : { userId: user, orgId: ORG };
      }
    }
  })();

async function boot() {
  const registry = createFlowRegistry();
  registry.register(openFlow("chat"));
  registry.register(openFlow("notes"));
  registry.register(secureFlow("vault"));
  registry.register(secureFlow("locked"), { pin: { orgId: ORG, userId: "bob" } });
  const stores = createInMemoryStores();
  const put = async (sessionId: string, owner: { flow: string; userId: string; orgId?: string; tenantId?: string }) => {
    const id = resolveSessionStorageKey(sessionId, owner.tenantId);
    const now = Date.now();
    await stores.session.set(
      id,
      {
        id,
        state: {},
        version: 0,
        createdAt: now,
        updatedAt: now,
        flowKind: owner.flow,
        flowId: owner.flow,
        userId: owner.userId,
        journal: [],
        ...(owner.orgId !== undefined ? { orgId: owner.orgId } : {}),
        ...(owner.tenantId !== undefined ? { tenantId: owner.tenantId } : {})
      },
      "absent"
    );
  };
  const admit = (caller: BlockCaller, sessionId: string) => admitNamedSession({ sessions: stores.session, registry, caller }, sessionId);
  return { put, admit };
}

/** Alice, running a block of `flowId` in session `a`. */
const alice = (flowId = "chat", extra: Partial<BlockCaller> = {}): BlockCaller => ({
  userId: "alice",
  orgId: ORG,
  flowId,
  sessionId: "a",
  ownsNothing: false,
  ...extra
});

describe("admitNamedSession", () => {
  it("admits another session of the same owner, on another open flow", async () => {
    const { put, admit } = await boot();
    await put("b", { flow: "notes", userId: "alice", orgId: ORG });
    expect((await admit(alice(), "b"))?.flowKind).toBe("notes");
  });

  it("admits a session of a flow with its own resolver to a block of that same flow", async () => {
    const { put, admit } = await boot();
    await put("v", { flow: "vault", userId: "alice", orgId: ORG });
    expect((await admit(alice("vault"), "v"))?.flowKind).toBe("vault");
  });

  // Each case: one session the caller must not reach, and the answer must be the unknown id's.
  const refusals: Array<[string, (put: Awaited<ReturnType<typeof boot>>["put"]) => Promise<void>, BlockCaller]> = [
    ["another user", (put) => put("b", { flow: "notes", userId: "bob", orgId: ORG }), alice()],
    ["the same user in another org", (put) => put("b", { flow: "notes", userId: "alice", orgId: "globex" }), alice()],
    ["the same user in another tenant", (put) => put("b", { flow: "notes", userId: "alice", orgId: ORG, tenantId: "t2" }), alice("chat", { tenantId: "t1" })],
    ["a session stored with no org", (put) => put("b", { flow: "notes", userId: "alice" }), alice()],
    ["an own-resolver instance whose pin refuses the caller", (put) => put("b", { flow: "locked", userId: "alice", orgId: ORG }), alice("locked")],
    [
      "a second schedule on the gateway principal",
      (put) => put("b", { flow: "notes", userId: "gateway", orgId: ORG }),
      { userId: "gateway", orgId: ORG, flowId: "chat", sessionId: "a", ownsNothing: true }
    ],
    ["a target whose flow has its own resolver, from a block of another flow", (put) => put("b", { flow: "vault", userId: "alice", orgId: ORG }), alice("chat")]
  ];

  for (const [name, plant, caller] of refusals) {
    it(`answers ${name} exactly as an unknown id`, async () => {
      const { put, admit } = await boot();
      await plant(put);
      const unknown = await admit(caller, "nobody-holds-this");
      expect(unknown).toBeUndefined();
      expect(await admit(caller, "b")).toEqual(unknown);
    });
  }

  it("admits, for each refusal above, the twin that differs only in the refused fact", async () => {
    // Pins every refusal to its own reason: the same fixture shape, with the
    // one fact flipped, is admitted.
    const { put, admit } = await boot();
    await put("own-user", { flow: "notes", userId: "alice", orgId: ORG });
    await put("own-tenant", { flow: "notes", userId: "alice", orgId: ORG, tenantId: "t1" });
    await put("own-pin", { flow: "locked", userId: "bob", orgId: ORG });
    await put("own-person", { flow: "notes", userId: "carol", orgId: ORG });
    expect(await admit(alice(), "own-user")).toBeDefined();
    expect(await admit(alice("chat", { tenantId: "t1" }), "own-tenant")).toBeDefined();
    expect(await admit({ ...alice("locked"), userId: "bob" }, "own-pin")).toBeDefined();
    // A schedule naming a person (not a machine) reaches that person's sessions.
    expect(await admit({ userId: "carol", orgId: ORG, flowId: "chat", sessionId: "a", ownsNothing: false }, "own-person")).toBeDefined();
  });

  it("still gives a caller that owns nothing its own session", async () => {
    const { put, admit } = await boot();
    await put("a", { flow: "chat", userId: "gateway", orgId: ORG });
    const gateway: BlockCaller = { userId: "gateway", orgId: ORG, flowId: "chat", sessionId: "a", ownsNothing: true };
    expect((await admit(gateway, "a"))?.userId).toBe("gateway");
  });
});

describe("principalOwnsNothing", () => {
  it("marks only a run the scheduled route stamped as a machine's, read only under the scheduled source", () => {
    expect(principalOwnsNothing("scheduled", { schedule: { origin: "static", machinePrincipal: true } })).toBe(true);
    // A static schedule that names a person is that person's: it owns what they own.
    expect(principalOwnsNothing("scheduled", { schedule: { origin: "static" } })).toBe(false);
    expect(principalOwnsNothing("scheduled", { schedule: { origin: "dynamic" } })).toBe(false);
    // A caller's metadata on a caller-facing source claims nothing.
    expect(principalOwnsNothing("http", { schedule: { origin: "static", machinePrincipal: true } })).toBe(false);
  });
});
