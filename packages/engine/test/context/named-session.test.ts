/**
 * A block's admission to a session it names: the routes' own admission, fed
 * the run's principal.
 *
 * Why these matter: a block that can name any session id is a door to every
 * conversation in the store. It must admit exactly what the HTTP routes admit
 * the same person, and every refusal must read as an unknown id, or a caller
 * learns which ids exist. Each refusal case below is compared with the answer
 * for an id nobody holds.
 *
 * The principal is the one a door sets (`kind`, `resolvedBy`); whether the
 * caller's own session is a machine's is read from that session's record
 * (`principalKind`, written at birth).
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowRegistry } from "../../src";
import { createInMemoryStores } from "../../src/host";
import { admitNamedSession } from "../../src/context/named-session";
import type { Principal, PrincipalKind } from "../../src/context/principal";
import { principalResolverIdentity } from "../../src/transports/auth/pickPrincipalResolver";
import { defaultBodyUserIdPrincipalResolver } from "../../src/transports/auth/defaultBodyUserIdPrincipalResolver";
import { resolveSessionStorageKey } from "../../src/stores/scope-keys";

const ORG = "acme";
const HOST = defaultBodyUserIdPrincipalResolver;

const run = handler({ name: "run", inputSchema: z.object({}), outputSchema: z.object({}), execute: () => ({}) });

/** A flow that takes its identity from the host's resolver. */
const openFlow = (kind: string) => defineFlow({ kind, actions: { run } })();

/** One resolver of their own, shared by `vault` and `locked`: a verified-header stand-in. */
const verifiedHeader = (context: { request?: Request }) => {
  const user = context.request?.headers.get("x-verified-user");
  return user === null || user === undefined ? null : { userId: user, orgId: ORG };
};
const secureFlow = (kind: string) => defineFlow({ kind, actions: { run }, authentication: { resolvePrincipal: verifiedHeader } })();

async function boot() {
  const registry = createFlowRegistry();
  registry.register(openFlow("chat"));
  registry.register(openFlow("notes"));
  registry.register(secureFlow("vault"));
  registry.register(secureFlow("locked"), { pin: { orgId: ORG, userId: "bob" } });
  const stores = createInMemoryStores();
  /** A session as its birth wrote it; `principalKind: null` plants one from before the field, with no request. */
  const put = async (
    sessionId: string,
    owner: { flow: string; userId: string; orgId?: string; tenantId?: string; principalKind?: PrincipalKind | null }
  ) => {
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
        ...(owner.tenantId !== undefined ? { tenantId: owner.tenantId } : {}),
        ...(owner.principalKind === null ? {} : { principalKind: owner.principalKind ?? "person" })
      },
      "absent"
    );
  };
  // Each caller's own session, as it was born: alice and carol people, the gateway a machine.
  await put("a", { flow: "chat", userId: "alice", orgId: ORG });
  await put("a", { flow: "chat", userId: "alice", orgId: ORG, tenantId: "t1" });
  await put("c", { flow: "chat", userId: "carol", orgId: ORG });
  await put("g", { flow: "chat", userId: "gateway", orgId: ORG, principalKind: "machine" });
  const admit = (caller: { principal: Principal; sessionId: string }, sessionId: string) =>
    admitNamedSession({ stores, registry, hostResolver: HOST, ...caller }, sessionId);
  /** The identity a door at `flowId` stamps as `resolvedBy`. */
  const resolverOf = (flowId: string) => principalResolverIdentity(registry, flowId, HOST);
  return { put, admit, resolverOf };
}

/** A run in the gateway's session `g`, as the scheduled route sets its principal. */
const gateway = { principal: { userId: "gateway", orgId: ORG, kind: "machine" } as Principal, sessionId: "g" };

/** Alice in session `a`, resolved by the door named `resolvedBy`. */
const alice = (extra: Partial<Principal> = {}, sessionId = "a") => ({
  principal: { userId: "alice", orgId: ORG, kind: "person", ...extra } as Principal,
  sessionId
});

describe("admitNamedSession", () => {
  it("admits another session of the same owner, on another open flow", async () => {
    const { put, admit } = await boot();
    await put("b", { flow: "notes", userId: "alice", orgId: ORG });
    expect((await admit(alice(), "b"))?.flowKind).toBe("notes");
  });

  it("admits a session of a flow with its own resolver to a principal that resolver produced", async () => {
    const { put, admit, resolverOf } = await boot();
    await put("v", { flow: "vault", userId: "alice", orgId: ORG });
    expect((await admit(alice({ resolvedBy: resolverOf("vault") }), "v"))?.flowKind).toBe("vault");
    // `locked` shares the resolver, so a principal from either door is the same answer the HTTP list gives.
    await put("bobs", { flow: "chat", userId: "bob", orgId: ORG });
    await put("own-pin", { flow: "locked", userId: "bob", orgId: ORG });
    const bob: Principal = { userId: "bob", orgId: ORG, kind: "person", resolvedBy: resolverOf("vault") };
    expect(await admit({ principal: bob, sessionId: "bobs" }, "own-pin")).toBeDefined();
  });

  // Each case: one session the caller must not reach, and the answer must be the unknown id's.
  type Put = Awaited<ReturnType<typeof boot>>["put"];
  type Resolver = Awaited<ReturnType<typeof boot>>["resolverOf"];
  const refusals: Array<[string, (put: Put) => Promise<void>, (resolverOf: Resolver) => { principal: Principal; sessionId: string }]> = [
    ["another user", (put) => put("b", { flow: "notes", userId: "bob", orgId: ORG }), () => alice()],
    ["the same user in another org", (put) => put("b", { flow: "notes", userId: "alice", orgId: "globex" }), () => alice()],
    ["the same user in another tenant", (put) => put("b", { flow: "notes", userId: "alice", orgId: ORG, tenantId: "t2" }), () => alice({ tenantId: "t1" })],
    ["a session stored with no org", (put) => put("b", { flow: "notes", userId: "alice" }), () => alice()],
    ["an own-resolver instance whose pin refuses the caller", (put) => put("b", { flow: "locked", userId: "alice", orgId: ORG }), (r) => alice({ resolvedBy: r("locked") })],
    ["a second schedule on the gateway principal", (put) => put("b", { flow: "notes", userId: "gateway", orgId: ORG, principalKind: "machine" }), () => gateway],
    [
      "anything, from a session stored before kinds with no request to say who made it",
      async (put) => {
        await put("old", { flow: "chat", userId: "alice", orgId: ORG, principalKind: null });
        await put("b", { flow: "notes", userId: "alice", orgId: ORG });
      },
      () => alice({}, "old")
    ],
    ["a target whose flow has its own resolver, from a principal the host's resolver produced", (put) => put("b", { flow: "vault", userId: "alice", orgId: ORG }), (r) => alice({ resolvedBy: r("chat") })],
    ["a target whose flow has its own resolver, from a principal no resolver produced", (put) => put("b", { flow: "vault", userId: "alice", orgId: ORG }), () => alice()],
    [
      "a person's principal in a machine's session",
      async (put) => {
        await put("m", { flow: "chat", userId: "alice", orgId: ORG, principalKind: "machine" });
        await put("b", { flow: "notes", userId: "alice", orgId: ORG });
      },
      () => alice({}, "m")
    ],
    ["a machine's principal in a person's session", (put) => put("b", { flow: "notes", userId: "alice", orgId: ORG }), () => alice({ kind: "machine" })]
  ];

  for (const [name, plant, caller] of refusals) {
    it(`answers ${name} exactly as an unknown id`, async () => {
      const { put, admit, resolverOf } = await boot();
      await plant(put);
      const unknown = await admit(caller(resolverOf), "nobody-holds-this");
      expect(unknown).toBeUndefined();
      expect(await admit(caller(resolverOf), "b")).toEqual(unknown);
    });
  }

  it("admits, for each refusal above, the twin that differs only in the refused fact", async () => {
    // Pins every refusal to its own reason: the same fixture shape, with the
    // one fact flipped, is admitted.
    const { put, admit, resolverOf } = await boot();
    await put("own-user", { flow: "notes", userId: "alice", orgId: ORG });
    await put("own-tenant", { flow: "notes", userId: "alice", orgId: ORG, tenantId: "t1" });
    await put("own-person", { flow: "notes", userId: "carol", orgId: ORG });
    expect(await admit(alice(), "own-user")).toBeDefined();
    expect(await admit(alice({ tenantId: "t1" }), "own-tenant")).toBeDefined();
    // A schedule naming a person (not a machine) reaches that person's sessions.
    expect(await admit({ principal: { userId: "carol", orgId: ORG, kind: "person" }, sessionId: "c" }, "own-person")).toBeDefined();
    // The gateway user from a session a person's principal made is admitted: the kind is the only refusal.
    await put("g2", { flow: "chat", userId: "gateway", orgId: ORG });
    await put("own-gateway", { flow: "notes", userId: "gateway", orgId: ORG, principalKind: "machine" });
    expect(await admit({ principal: { userId: "gateway", orgId: ORG, kind: "person" }, sessionId: "g2" }, "own-gateway")).toBeDefined();
    await put("own-vault", { flow: "vault", userId: "alice", orgId: ORG });
    expect(await admit(alice({ resolvedBy: resolverOf("vault") }), "own-vault")).toBeDefined();
  });

  it("still gives a machine its own session", async () => {
    const { admit } = await boot();
    expect((await admit(gateway, "g"))?.userId).toBe("gateway");
  });
});
