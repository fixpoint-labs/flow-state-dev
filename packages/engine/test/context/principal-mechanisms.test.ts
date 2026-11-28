// FIX-2942.
/**
 * The principal's mechanisms: who a named reach admits once `kind` and
 * `resolvedBy` are set at the door and carried unchanged. Each describe is one
 * mechanism, with the case it admits and the cases it refuses.
 *
 * Why these matter: each is a way a run could reach a session a browser can't
 * (an own-resolver flow on another resolver's word, a schedule's machine, a
 * session that lost its machine mark to a stale write, a session from before
 * kinds), or a way the one exact owner comparison could refuse an owner it
 * must not (a retry of a request id from before orgs). Sessions are born
 * through real hosts where the case is about a run; cases about records from
 * before a field plant those records as they were stored.
 *
 * Every refusal is compared with the answer for an id nobody holds. The goal
 * check `goals/sessions-reach/one-principal/` runs the same mechanisms and
 * shows each one's broken stand-in failing.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler, type ScheduleConfig } from "@flow-state-dev/core";
import {
  createBearerSecretPrincipalResolver,
  createFlowApiRouter,
  createFlowRegistry,
  defaultBodyUserIdPrincipalResolver,
  disposeFlowApiRouter,
  runAction,
  type StoreRegistry
} from "../../src";
import { createInboundTransportHost, createInMemoryStores } from "../../src/host";
import { admitNamedSession } from "../../src/context/named-session";
import type { Principal } from "../../src/context/principal";
import { claimRequestRecord, resolveCallerRequestId } from "../../src/context/request-principal";
import { createInitialRequestRecord } from "../../src/context/initial-request-record";
import { RequestOwnerMismatchError } from "../../src/context/binding-errors";
import { callerReachesRequest } from "../../src/routes/route-utils";
import { recentTimes } from "../transports/scheduled/recent-times";

// ── fixtures ────────────────────────────────────────────────────────────────

const ORG = "acme";
const SECRET = "scheduler-secret";
const HOURLY = "0 * * * *";
const { latest: LATEST } = recentTimes(HOURLY);
const GATEWAY = { userId: "cron-gateway", orgId: ORG };
const UNKNOWN = "nobody-holds-this";

const run = handler({ name: "run", inputSchema: z.object({}).passthrough(), outputSchema: z.object({}).passthrough(), execute: () => ({}) });

/** A resolver of its own: the verified-header stand-in two flows share. */
const verifiedHeader = (context: { request?: Request }) => {
  const user = context.request?.headers.get("x-verified-user");
  return user === null || user === undefined ? null : { userId: user, orgId: ORG };
};

const notes = defineFlow({ kind: "notes", actions: { run } })();
const vault = defineFlow({ kind: "vault", actions: { run }, authentication: { resolvePrincipal: verifiedHeader } })();
// The same resolver under another host setting: a principal from its door is a different answer.
const vaultLax = defineFlow({
  kind: "vault-lax",
  actions: { run },
  authentication: { resolvePrincipal: verifiedHeader, defaultUserId: "anon" }
})();

const schedule = (extra: Partial<ScheduleConfig>): ScheduleConfig => ({ cron: HOURLY, block: run, session: "per-schedule", onOverlap: "allow", ...extra });
const polls = defineFlow({
  kind: "polls",
  schedules: {
    static: {
      fallback: schedule({}),
      explicit: schedule({ principal: { ...GATEWAY } }),
      carol: schedule({ principal: { userId: "u_carol", orgId: ORG } }),
      "carol-two": schedule({ principal: { userId: "u_carol", orgId: ORG } })
    }
  },
  actions: {},
  internal: { actions: { wake: { block: run } } }
})();

/** The principal a run started from `requestId`'s record carries: the one its door set. */
async function principalOf(stores: StoreRegistry, requestId: string): Promise<{ principal: Principal; sessionId: string }> {
  for (let i = 0; i < 300; i += 1) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") {
      expect(record.status).toBe("completed");
      return {
        principal: {
          userId: record.userId,
          orgId: record.orgId!,
          ...(record.tenantId != null ? { tenantId: record.tenantId } : {}),
          kind: record.principalKind ?? "machine",
          ...(record.resolvedBy != null ? { resolvedBy: record.resolvedBy } : {})
        },
        sessionId: record.sessionId!
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`request ${requestId} did not settle`);
}

/** A host whose own resolver is the body-userId default, with `vault` and `vault-lax` on their own. */
function doorHost() {
  const registry = createFlowRegistry();
  registry.register(notes);
  registry.register(vault);
  registry.register(vaultLax);
  const stores = createInMemoryStores();
  const host = createInboundTransportHost({ registry, stores, resolvePrincipal: defaultBodyUserIdPrincipalResolver, runtimeConfig: {} });
  /** Resolve alice at `flowKind`'s door, then run there in `sessionId`: the session is born from that run. */
  const runAt = async (flowKind: string, sessionId: string) => {
    const principal = await host.resolvePrincipal({
      source: "http",
      request: new Request("http://localhost", { headers: { "x-verified-user": "alice" } }),
      envelope: { flowKind, action: "run", input: {}, metadata: { body: { userId: "alice" } } }
    });
    const handle = host.dispatch({ source: "http", flowKind, action: "run", input: {}, sessionId, principal, responseEmitter: null });
    await handle.finished;
    return principalOf(stores, handle.requestId);
  };
  /** `known: false` is a process that can't name the host's resolver. */
  const admit = (caller: { principal: Principal; sessionId: string }, target: string, known = true) =>
    admitNamedSession({ stores, registry, ...(known ? { hostResolver: defaultBodyUserIdPrincipalResolver } : {}), ...caller }, target);
  return { runAt, admit, stores, registry };
}

const routers: ReturnType<typeof createFlowApiRouter>[] = [];
afterEach(async () => {
  await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
});

/** A router whose host resolver is the scheduler's bearer secret. */
function scheduleHost() {
  const registry = createFlowRegistry();
  registry.register(polls);
  registry.register(vault);
  const stores = createInMemoryStores();
  const resolvePrincipal = createBearerSecretPrincipalResolver({ secret: SECRET, principal: GATEWAY });
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0, resolvePrincipal });
  routers.push(router);
  const fire = async (scheduleId: string) => {
    const response = await router.POST(
      new Request(`http://localhost/api/flows/polls/schedules/${scheduleId}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
        body: JSON.stringify({ nominalFireTime: LATEST })
      }),
      { params: { path: ["polls", "schedules", scheduleId, "dispatch"] } }
    );
    const fired = (await response.json()) as { status: string; requestId: string };
    expect(fired.status).toBe("accepted");
    return principalOf(stores, fired.requestId);
  };
  const admit = (caller: { principal: Principal; sessionId: string }, target: string) =>
    admitNamedSession({ stores, registry, hostResolver: resolvePrincipal, ...caller }, target);
  return { fire, admit, stores };
}

/** Plant a session record as a store holds it; no `principalKind` unless given. */
async function plantSession(
  stores: StoreRegistry,
  id: string,
  fields: { userId?: string; orgId?: string; parentSessionId?: string; lineageId?: string; principalKind?: "person" | "machine"; flow?: string } = {}
) {
  const now = Date.now();
  await stores.session.set(
    id,
    {
      id,
      state: {},
      version: 0,
      createdAt: now,
      updatedAt: now,
      flowKind: fields.flow ?? "notes",
      flowId: fields.flow ?? "notes",
      userId: fields.userId ?? "alice",
      orgId: fields.orgId ?? ORG,
      journal: [],
      ...(fields.parentSessionId !== undefined ? { parentSessionId: fields.parentSessionId } : {}),
      ...(fields.lineageId !== undefined ? { lineageId: fields.lineageId } : {}),
      ...(fields.principalKind !== undefined ? { principalKind: fields.principalKind } : {})
    },
    "any"
  );
}

/** Plant a request record in `sessionId`, as stored by a release before `principalKind`. */
async function plantRequest(
  stores: StoreRegistry,
  id: string,
  sessionId: string,
  fields: { source?: string; userId?: string; orgId?: string | null; at?: number; endedAt?: number } = {}
) {
  const at = fields.at ?? Date.now();
  const record = createInitialRequestRecord(
    {
      requestId: id,
      flowKind: "notes",
      flowId: "notes",
      actionName: "run",
      userId: fields.userId ?? "alice",
      sessionId,
      ...(fields.orgId === null ? {} : { orgId: fields.orgId ?? ORG }),
      ...(fields.source !== undefined ? { source: fields.source } : {})
    },
    at
  );
  // `endedAt`: when its run wrote it last (its final status); by default never written again.
  const endedAt = fields.endedAt ?? at;
  await stores.request.set(id, { ...record, status: "completed", finalizedAtMs: Date.now(), completedAtMs: endedAt, updatedAt: endedAt }, "absent");
}

/** A person's run in `sessionId`: what an HTTP turn in a session from before kinds carries. */
const personIn = (sessionId: string) => ({ principal: { userId: "alice", orgId: ORG, kind: "person" } as Principal, sessionId });

// ── the rows ────────────────────────────────────────────────────────────────

describe("own-resolver admit", () => {
  it("admits a run whose principal the target's own resolver produced to that flow's other session", async () => {
    const env = doorHost();
    const from = await env.runAt("vault", "v1");
    await env.runAt("vault", "v2");
    expect(from.principal.resolvedBy).toBeDefined();
    expect((await env.admit(from, "v2"))?.flowKind).toBe("vault");
  });
});

describe("absent resolvedBy", () => {
  it("reads an own-resolver target as missing for a principal with none, a target resolver with none, and other host settings", async () => {
    const env = doorHost();
    const from = await env.runAt("vault", "v1");
    await env.runAt("vault", "v2");
    const unknown = await env.admit(from, UNKNOWN);
    expect(unknown).toBeUndefined();
    const { resolvedBy: _resolvedBy, ...noResolver } = from.principal;
    // A principal with none.
    expect(await env.admit({ ...from, principal: noResolver }, "v2")).toEqual(unknown);
    // A target resolver with none (this side cannot name the host's resolver), on either principal.
    expect(await env.admit(from, "v2", false)).toEqual(unknown);
    expect(await env.admit({ ...from, principal: noResolver }, "v2", false)).toEqual(unknown);
    // The same resolver under other host settings: `vault-lax` names a default user.
    const lax = await env.runAt("vault-lax", "lax1");
    expect(lax.principal.resolvedBy).not.toBe(from.principal.resolvedBy);
    expect(await env.admit(lax, "v2")).toEqual(unknown);
  });
});

describe("a schedule naming a person", () => {
  it("reaches that person's host-rule targets", async () => {
    const env = scheduleHost();
    const first = await env.fire("carol");
    const second = await env.fire("carol-two");
    expect(first.principal.userId).toBe("u_carol");
    expect(first.sessionId).not.toBe(second.sessionId);
    expect((await env.admit(first, second.sessionId))?.userId).toBe("u_carol");
  });

  it("reads an own-resolver target as missing: no resolver of the target's produced its principal", async () => {
    const env = scheduleHost();
    const first = await env.fire("carol");
    await plantSession(env.stores, "carol-vault", { userId: "u_carol", flow: "vault", principalKind: "person" });
    expect(await env.admit(first, "carol-vault")).toEqual(await env.admit(first, UNKNOWN));
  });

  it("is a machine when it runs as the gateway, which reaches no other gateway session", async () => {
    const env = scheduleHost();
    const fallback = await env.fire("fallback");
    const explicit = await env.fire("explicit");
    expect(fallback.principal.kind).toBe("machine");
    expect(explicit.principal.kind).toBe("machine");
    expect(await env.admit(fallback, explicit.sessionId)).toEqual(await env.admit(fallback, UNKNOWN));
    expect(await env.admit(fallback, fallback.sessionId)).toBeDefined();
  });
});

describe("sticky kind", () => {
  it("keeps a machine's session a machine's against a stale whole-record write carrying person, and it still reaches nothing", async () => {
    const env = scheduleHost();
    const fallback = await env.fire("fallback");
    const explicit = await env.fire("explicit");
    // A writer holding a snapshot in which the session was a person's writes it back whole.
    const stored = await env.stores.session.get(fallback.sessionId);
    await env.stores.session.set(fallback.sessionId, { ...stored!, principalKind: "person", version: stored!.version + 1 }, "any");
    expect((await env.stores.session.get(fallback.sessionId))?.principalKind).toBe("machine");
    // A later run in that session, started with no principal kind of its own (a wake), runs as the session's.
    const woke = await runAction({
      flow: polls,
      actionName: "wake" as never,
      input: {},
      userId: fallback.principal.userId,
      orgId: fallback.principal.orgId,
      sessionId: fallback.sessionId,
      source: "internal",
      metadata: {},
      stores: env.stores,
      runtimeConfig: {}
    });
    const later = await principalOf(env.stores, woke.requestId!);
    expect(later.principal.kind).toBe("machine");
    expect(await env.admit(later, explicit.sessionId)).toEqual(await env.admit(later, UNKNOWN));
  });
});

describe("backfill", () => {
  it("reads a session from before kinds as its birth request's kind", async () => {
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(notes);
    const admit = (caller: { principal: Principal; sessionId: string }, target: string) =>
      admitNamedSession({ stores, registry, hostResolver: defaultBodyUserIdPrincipalResolver, ...caller }, target);
    await plantSession(stores, "target", { principalKind: "person" });
    // Person: an HTTP start, and one from before `source` (read as `http`).
    await plantSession(stores, "l-http", { lineageId: "lin_http" });
    // The birth request is written just before the session and its run ends
    // after it; a later turn's doesn't count, however soon it comes.
    const born = (await stores.session.get("l-http"))!.createdAt;
    await plantRequest(stores, "r-http-2", "l-http", { source: "internal", at: born + 5 });
    await plantRequest(stores, "r-http", "l-http", { source: "http", at: born - 5, endedAt: born + 1_000 });
    await plantSession(stores, "l-legacy");
    await plantRequest(stores, "r-legacy", "l-legacy");
    expect(await admit(personIn("l-http"), "target")).toBeDefined();
    expect(await admit(personIn("l-legacy"), "target")).toBeDefined();
    // A dispatched child the parent can be proven for, by the lineage it inherited.
    await plantSession(stores, "l-child", { parentSessionId: "l-http", lineageId: "lin_http" });
    await plantRequest(stores, "r-child", "l-child", { source: "internal" });
    expect(await admit(personIn("l-child"), "target")).toBeDefined();
  });

  it("reads one with no readable request, or whose parent is missing, recreated or past the depth bound, as a machine's", async () => {
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(notes);
    const admit = (caller: { principal: Principal; sessionId: string }, target: string) =>
      admitNamedSession({ stores, registry, hostResolver: defaultBodyUserIdPrincipalResolver, ...caller }, target);
    await plantSession(stores, "target", { principalKind: "person" });
    const unknown = await admit(personIn("l-none"), UNKNOWN);
    expect(unknown).toBeUndefined();
    // No readable request.
    await plantSession(stores, "l-none");
    expect(await admit(personIn("l-none"), "target")).toEqual(unknown);
    // A machine's sources, and one no list names.
    for (const source of ["scheduled", "webhook", "notification", "a-custom-transport"]) {
      await plantSession(stores, `l-${source}`);
      await plantRequest(stores, `r-${source}`, `l-${source}`, { source });
      expect(await admit(personIn(`l-${source}`), "target")).toEqual(unknown);
    }
    // A parent recreated under its id: a person's again, but a new incarnation with a new lineage.
    await plantSession(stores, "p-recreated", { lineageId: "lin_new" });
    await plantRequest(stores, "r-p-recreated", "p-recreated", { source: "http" });
    await plantSession(stores, "l-orphan", { parentSessionId: "p-recreated", lineageId: "lin_old" });
    await plantRequest(stores, "r-orphan", "l-orphan", { source: "internal" });
    expect(await admit(personIn("l-orphan"), "target")).toEqual(unknown);
    // A parent that is gone.
    await plantSession(stores, "l-lost", { parentSessionId: "p-gone", lineageId: "lin_gone" });
    await plantRequest(stores, "r-lost", "l-lost", { source: "task" });
    expect(await admit(personIn("l-lost"), "target")).toEqual(unknown);
    // A chain past the depth bound, rooted at a person's session.
    await plantSession(stores, "deep-0", { lineageId: "lin_deep" });
    await plantRequest(stores, "r-deep-0", "deep-0", { source: "http" });
    for (let i = 1; i <= 33; i += 1) {
      await plantSession(stores, `deep-${i}`, { parentSessionId: `deep-${i - 1}`, lineageId: "lin_deep" });
      await plantRequest(stores, `r-deep-${i}`, `deep-${i}`, { source: "internal" });
    }
    expect(await admit(personIn("deep-33"), "target")).toEqual(unknown);
    // The same chain within the bound is a person's.
    expect(await admit(personIn("deep-31"), "target")).toBeDefined();
  });
});

describe("pre-org request retry", () => {
  it("lets the owner retrying a request id whose record predates orgs reuse it, and nobody else", async () => {
    const stores = createInMemoryStores();
    await plantSession(stores, "s-old");
    await plantRequest(stores, "req-old", "s-old", { orgId: null });
    const alice = { userId: "alice", orgId: ORG };
    expect(await resolveCallerRequestId(stores, "req-old", alice)).toBe("req-old");
    expect(await resolveCallerRequestId(stores, "req-old", { userId: "bob", orgId: ORG })).not.toBe("req-old");
    const flow = notes;
    const retry = createInitialRequestRecord(
      { requestId: "req-old", flowKind: "notes", flowId: "notes", actionName: "run", userId: "alice", orgId: ORG, sessionId: "s-old" },
      Date.now()
    );
    await expect(claimRequestRecord(stores, flow, retry)).resolves.toMatchObject({ id: "req-old" });
    await expect(claimRequestRecord(stores, flow, { ...retry, userId: "bob" })).rejects.toBeInstanceOf(RequestOwnerMismatchError);
  });

  it("is no one's once the id is taken again: the replacement session's organization proves nothing about it", async () => {
    const stores = createInMemoryStores();
    await plantSession(stores, "s-old");
    const original = (await stores.session.get("s-old"))!;
    await plantRequest(stores, "req-old", "s-old", { orgId: null, at: original.createdAt + 5 });
    // The original session is deleted; the same user takes the id again, in another organization.
    await stores.session.delete("s-old");
    await stores.session.set("s-old", { ...original, orgId: "globex", createdAt: original.createdAt + 60_000, version: 0 }, "any");
    const replacement = { userId: "alice", orgId: "globex" };
    const record = (await stores.request.get("req-old"))!;
    expect(await callerReachesRequest(stores, record, undefined, replacement)).toBe(false);
    expect(await resolveCallerRequestId(stores, "req-old", replacement)).not.toBe("req-old");
  });
});
