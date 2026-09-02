/**
 * FIX-1010 — `GET /sessions/:sessionId/children`, exercised as HTTP
 * requests against the real router rather than as calls to the store. The
 * parentage predicate is already proved in `session-parentage-listing.test.ts`;
 * what is unproven is that the *route* reaches it correctly and refuses
 * correctly.
 *
 * Every boundary case is seeded directly, because no shipped writer produces a
 * child that crosses one — which is the point. The guards exist so the
 * property does not depend on one writer's convention.
 *
 * The `topic`/`coordinate` labels are the opposite case and are exercised
 * through the real dispatch seam instead: a writer does produce them, so
 * seeding them by hand would assert a shape nothing emits and pass whether or
 * not the feature exists.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  parseFlowRoute,
  type ChildSessionSummary
} from "../src";
import type { RequestRecord, SessionRecord, StoreRegistry } from "../src";
import { createRequestHost } from "../src/context/create-request-host";
import { TERMINAL_WIRE_STATUS } from "../src/routes/child-session-routes";

type Router = ReturnType<typeof createFlowApiRouter>;

function openFlow(kind: string) {
  return defineFlow({
    kind,
    actions: {
      run: {
        inputSchema: z.object({}),
        block: handler({
          name: `${kind}-run`,
          inputSchema: z.object({}),
          outputSchema: z.object({}),
          execute: () => ({})
        })
      }
    }
  });
}

/** A flow whose identity comes from a verified header — a real resolver stand-in. */
function secureFlow(kind: string) {
  return defineFlow({
    kind,
    actions: {
      run: {
        inputSchema: z.object({}),
        block: handler({
          name: `${kind}-run`,
          inputSchema: z.object({}),
          outputSchema: z.object({}),
          execute: () => ({})
        })
      }
    },
    authentication: {
      resolvePrincipal: (context) => {
        const user = context.request?.headers.get("x-verified-user");
        return user === null || user === undefined ? null : { userId: user };
      }
    }
  });
}

function buildRouter(
  flows: Array<ReturnType<typeof openFlow>> = [openFlow("chat")],
  runtime: { maxChildSessionListLimit?: number } = {}
): { router: Router; stores: StoreRegistry } {
  const registry = createFlowRegistry();
  for (const flow of flows) registry.register(flow);
  const stores = createInMemoryStores();
  return {
    router: createFlowApiRouter({ registry, stores, ...runtime }),
    stores
  };
}

function call(
  router: Router,
  path: string[],
  opts: { query?: string; headers?: Record<string, string> } = {}
): Promise<Response> {
  const query = opts.query === undefined ? "" : `?${opts.query}`;
  return router.GET(
    new Request(`http://localhost/api/flows/${path.join("/")}${query}`, {
      headers: opts.headers ?? {}
    }),
    { params: { path } }
  );
}

async function children(
  router: Router,
  parentId: string,
  opts: { query?: string; headers?: Record<string, string> } = {}
): Promise<ChildSessionSummary[]> {
  const res = await call(router, ["sessions", parentId, "children"], opts);
  expect(res.status).toBe(200);
  return ((await res.json()) as { children: ChildSessionSummary[] }).children;
}

function sessionRecord(
  id: string,
  overrides: Partial<SessionRecord> = {}
): SessionRecord {
  const now = Date.now();
  return {
    id,
    flowKind: "chat",
    userId: "alice",
    state: {},
    version: 0,
    createdAt: now,
    updatedAt: now,
    journal: [],
    ...overrides
  };
}

async function seedSession(
  stores: StoreRegistry,
  id: string,
  overrides: Partial<SessionRecord> = {}
): Promise<void> {
  const record = sessionRecord(id, overrides);
  await stores.session.set(record.id, record, "any");
}

let requestSeq = 0;

async function seedRequest(
  stores: StoreRegistry,
  init: {
    id?: string;
    sessionId: string;
    status: RequestRecord["status"];
    startedAtMs?: number;
  } & Partial<RequestRecord>
): Promise<void> {
  const now = init.startedAtMs ?? Date.now() + requestSeq++;
  const { id, ...rest } = init;
  const record: RequestRecord = {
    id: id ?? `req_${requestSeq++}`,
    flowKind: "chat",
    actionName: "run",
    userId: "alice",
    source: "http",
    startedAtMs: now,
    state: {},
    version: 0,
    createdAt: now,
    updatedAt: now,
    ...rest
  } as RequestRecord;
  await stores.request.set(record.id, record, "any");
}

// ---------------------------------------------------------------------------
// The route itself, and the classification that holds decision 1
// ---------------------------------------------------------------------------

describe("route registration", () => {
  it("resolves GET /sessions/:sessionId/children", () => {
    expect(parseFlowRoute("GET", ["sessions", "sess_abc", "children"])).toEqual({
      kind: "list_session_children",
      sessionId: "sess_abc"
    });
  });

  it("does not shadow the sibling session reads", () => {
    expect(parseFlowRoute("GET", ["sessions", "sess_abc", "requests"]).kind).toBe(
      "list_session_requests"
    );
    expect(parseFlowRoute("GET", ["sessions", "sess_abc", "state"]).kind).toBe(
      "get_session_state"
    );
  });

  /**
   * The assertion that fails loudly if a future refactor reclassifies the
   * route as host-wide, which is how decision 1 would be silently undone: a
   * host-addressed route never loads the parent as a record, so the parent is
   * never ownership- or tenant-checked.
   *
   * Asserted from the outside — an anonymous caller in a mixed app gets 401
   * because the *addressed parent's* flow authenticates. A host-classified
   * route would instead fall through to the cross-flow withholding path and
   * answer 200.
   */
  it("is session-addressed on the path id, not host-wide", async () => {
    const { router, stores } = buildRouter([secureFlow("secure")]);
    await seedSession(stores, "parent", { flowKind: "secure" });

    const anonymous = await call(router, ["sessions", "parent", "children"]);
    expect(anonymous.status).toBe(401);

    const owner = await call(router, ["sessions", "parent", "children"], {
      headers: { "x-verified-user": "alice" }
    });
    expect(owner.status).toBe(200);
  });

  it("403s a caller who authenticated but does not own the parent", async () => {
    const { router, stores } = buildRouter([secureFlow("secure")]);
    await seedSession(stores, "parent", { flowKind: "secure", userId: "alice" });

    const res = await call(router, ["sessions", "parent", "children"], {
      headers: { "x-verified-user": "mallory" }
    });
    // Deliberately not 404: the caller authenticated and already holds the id.
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// The shape of the answer
// ---------------------------------------------------------------------------

describe("the read", () => {
  it("returns the parent's children, addressed through the parent", async () => {
    const { router, stores } = buildRouter();
    await seedSession(stores, "parent");
    await seedSession(stores, "child_a", { parentSessionId: "parent" });
    await seedSession(stores, "child_b", { parentSessionId: "parent" });
    await seedSession(stores, "unrelated");

    const rows = await children(router, "parent");
    expect(rows.map((r) => r.id).sort()).toEqual(["child_a", "child_b"]);
    expect(rows.every((r) => r.parentSessionId === "parent")).toBe(true);
  });

  it("404s an absent parent", async () => {
    const { router } = buildRouter();
    const res = await call(router, ["sessions", "nope", "children"]);
    expect(res.status).toBe(404);
  });

  it("200s with an empty list when the parent has no children", async () => {
    const { router, stores } = buildRouter();
    await seedSession(stores, "parent");
    // Not 404 — "no background work" is an ordinary answer, and a client that
    // has to branch on it will get it wrong.
    expect(await children(router, "parent")).toEqual([]);
  });

  it("lists a child's own children — nesting is legal", async () => {
    const { router, stores } = buildRouter();
    await seedSession(stores, "parent");
    await seedSession(stores, "child", { parentSessionId: "parent" });
    await seedSession(stores, "grandchild", { parentSessionId: "child" });

    expect((await children(router, "child")).map((r) => r.id)).toEqual([
      "grandchild"
    ]);
  });

  /**
   * The response carries a named field set, never `...record`. The sibling
   * listing spreads whole session records, which here would put every child's
   * append-only journal on the wire, unbounded per row and multiplied by the
   * page. Asserting the whole shape, because "we narrowed it" is not
   * observable from a test that only reads the fields it expects.
   */
  it("carries the locked field set and nothing else", async () => {
    const { router, stores } = buildRouter();
    await seedSession(stores, "parent");
    await seedSession(stores, "child", {
      parentSessionId: "parent",
      journal: Array.from({ length: 50 }, (_, i) => ({
        ts: i,
        type: "note",
        text: `entry ${i}`
      })) as SessionRecord["journal"],
      state: { secret: "should not ship" },
      resources: { big: { blob: "x".repeat(1000) } }
    });

    const [row] = await children(router, "parent");
    expect(Object.keys(row).sort()).toEqual([
      "createdAt",
      "id",
      "parentSessionId",
      "updatedAt"
    ]);
  });

  /**
   * A child appears under exactly one parent and never in a top-level
   * listing. The tempting assertion — that the two result sets are disjoint —
   * is true but weak: it passes if both are empty.
   */
  it("a child is under its parent and absent from the top-level listing", async () => {
    const { router, stores } = buildRouter();
    await seedSession(stores, "parent");
    await seedSession(stores, "child", { parentSessionId: "parent" });

    expect((await children(router, "parent")).map((r) => r.id)).toEqual([
      "child"
    ]);

    const listed = await call(router, ["sessions"]);
    const { sessions } = (await listed.json()) as { sessions: SessionRecord[] };
    expect(sessions.map((s) => s.id)).toEqual(["parent"]);
  });

  it("leaves the existing session listing byte for byte unchanged", async () => {
    const { router, stores } = buildRouter();
    await seedSession(stores, "parent");
    const before = await (await call(router, ["sessions"])).text();

    await seedSession(stores, "child", { parentSessionId: "parent" });
    const after = await (await call(router, ["sessions"])).text();

    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// The row labels, through the writer that actually stamps them
// ---------------------------------------------------------------------------

/**
 * `topic` and `coordinate` name the body of work and the address handling it.
 * Without them a UI can only label background work by an opaque derived id.
 *
 * **Every case here goes through the real dispatch seam.** The earlier
 * version of this suite hand-seeded the two fields onto a session record, which
 * asserted a shape no writer emitted — so it stayed green while nothing wrote
 * them, and an endpoint advertising labels it never returned reached review.
 * A test that cannot fail is worse than no test, because it is counted. Delete
 * the stamp in `context/create-request-host.ts` and the first case below fails.
 *
 * Under the message protocol, `topic` and `coordinate` are simpler than they
 * were: `topic` is exactly the dispatch's session key (there is no longer a
 * separate "worker" seed field to combine it with), and `coordinate` is the
 * dispatch's own static address (`type:target`) — always present for a
 * dispatched child, never a caller-suppliable label. That is a stronger
 * property than the old shape had, and it is why the old suite's "omits
 * coordinate", "empty seed field" and "forged record bag" cases have no
 * counterpart here: none of those states are reachable any more.
 */
const LIVENESS = {
  heartbeatIntervalMs: 10_000,
  staleThresholdMs: 60_000,
  staleSweepIntervalMs: 30_000
};

/** The shipped dispatch seam, wired to the stores the router reads. */
function dispatchSeam(stores: StoreRegistry) {
  const instance = openFlow("chat")({ id: "chat" });
  const { seam } = createRequestHost({
    stores,
    // A dispatch resolves into the flow's own `internal` entry and never into
    // a caller-addressed action; a flow without one refuses before it writes.
    flow: { ...instance, internal: { core: { block: instance.actions.run!.block } } },
    // The running request's server-derived identity. The child's parent is
    // this session, and the caller names none of it.
    identity: {
      userId: "alice",
      tenantId: undefined,
      orgId: undefined,
      sessionId: "parent",
      lineageId: "lin_parent"
    },
    dispatchOperation: async ({ sessionId }) => {
      // A real run on the child, so a labelled row also resolves a status —
      // the two must not be traded against each other.
      const requestId = `req_${sessionId}`;
      await seedRequest(stores, { id: requestId, sessionId, status: "in_progress" });
      return { requestId };
    },
    liveness: LIVENESS
  });
  return seam;
}

/** Dispatch a child under `parent` through the real writer, keyed on `key`. */
async function startChild(stores: StoreRegistry, key: string): Promise<string> {
  const result = await dispatchSeam(stores)({
    type: "internal",
    target: "core",
    session: { key },
    payload: {},
    from: "spawn"
  });
  if (!result.ok) throw new Error(`dispatch refused: ${result.refused}`);
  return result.sessionId;
}

describe("row labels, as the dispatch seam stamps them", () => {
  it("labels a job dispatched through the seam with its key as topic and its address as coordinate", async () => {
    const { router, stores } = buildRouter();
    await seedSession(stores, "parent");

    const childId = await startChild(stores, "market-research");

    const [row] = await children(router, "parent");
    // The row the route returns is the child the writer created, not a
    // look-alike seeded beside it.
    expect(row?.id).toBe(childId);
    expect(row?.topic).toBe("market-research");
    expect(row?.coordinate).toBe("internal:core");
    expect(row?.status).toBe("active");
  });

  /**
   * BP-030. A child written before these fields existed carries neither, and a
   * store that nulls absent keys hands back `null` for both. All of it means
   * *unlabelled* — a row a UI shows without a name — and none of it is an
   * error. The writer does not backfill an adopted legacy child either.
   */
  it("reads a child written before the fields existed as unlabelled", async () => {
    const { router, stores } = buildRouter();
    await seedSession(stores, "parent");
    await seedSession(stores, "legacy", { parentSessionId: "parent", createdAt: 1 });
    await seedSession(stores, "nulled", {
      parentSessionId: "parent",
      createdAt: 2,
      // Not a shape the type can express, but one a reader meets: this is the
      // adapter's null-for-absent, not a writer's output.
      ...({ topic: null, coordinate: null } as unknown as Partial<SessionRecord>)
    });

    const rows = await children(router, "parent");
    expect(rows.map((r) => r.id).sort()).toEqual(["legacy", "nulled"]);
    for (const row of rows) {
      expect(row).not.toHaveProperty("topic");
      expect(row).not.toHaveProperty("coordinate");
    }
  });

  /**
   * The constraint that makes keeping these fields safe: they decide nothing.
   * `evaluateAdoption` plus the `key-occupied` refusal stay the sole
   * discriminator for "is this session ours", so a record sitting at the
   * derived key is adopted on its identity alone — a disagreeing label neither
   * blocks an adoption nor licenses one. A second discriminator is exactly what
   * could contradict the first and hand a session to the wrong owner.
   */
  it("never lets a label decide an adoption", async () => {
    const { router, stores } = buildRouter();
    await seedSession(stores, "parent");

    const childId = await startChild(stores, "review");

    // Rewrite the child's label to something the key would never produce,
    // leaving its identity untouched.
    const child = await stores.session.get(childId);
    await stores.session.set(childId, { ...child!, topic: "not-the-key" }, "any");

    // Same key, same derived child: adopted on identity, label ignored.
    const again = await dispatchSeam(stores)({
      type: "internal",
      target: "core",
      session: { key: "review" },
      payload: {},
      from: "spawn"
    });
    expect(again).toMatchObject({ ok: true, adopted: true, sessionId: childId });

    // And the route reports what is stored rather than re-deriving it — the
    // labels are display, so nothing repairs them behind a reader's back.
    const [row] = await children(router, "parent");
    expect(row?.topic).toBe("not-the-key");
  });
});

// ---------------------------------------------------------------------------
// The identity boundary (spec §7 rule 0 / rule 1)
// ---------------------------------------------------------------------------

describe("the identity boundary", () => {
  it("does not return a same-tenant child owned by another user", async () => {
    const { router, stores } = buildRouter();
    await seedSession(stores, "parent", { userId: "alice" });
    await seedSession(stores, "mine", { parentSessionId: "parent", userId: "alice" });
    await seedSession(stores, "theirs", { parentSessionId: "parent", userId: "bob" });
    await seedRequest(stores, { sessionId: "theirs", status: "failed", userId: "bob" });

    const rows = await children(router, "parent");
    expect(rows.map((r) => r.id)).toEqual(["mine"]);
  });

  /**
   * Without the flow-kind conjunction an anonymous caller reads summaries out
   * of a flow that authenticates, by going through one that does not — hop 1
   * allows, hop 2 rejects, and the row has already been handed over. Paired
   * with hop 2 refusing the same caller, so the test shows the two routes
   * agreeing rather than each being separately plausible.
   */
  it("does not return a child stamped with another flow's kind", async () => {
    const { router, stores } = buildRouter([openFlow("chat"), secureFlow("secure")]);
    await seedSession(stores, "parent", { flowKind: "chat" });
    await seedSession(stores, "ours", { parentSessionId: "parent", flowKind: "chat" });
    await seedSession(stores, "theirs", {
      parentSessionId: "parent",
      flowKind: "secure"
    });

    expect((await children(router, "parent")).map((r) => r.id)).toEqual(["ours"]);

    // Hop 2 on the same child, same anonymous caller, refuses.
    const hop2 = await call(router, ["sessions", "theirs", "requests"]);
    expect(hop2.status).toBe(401);
  });

  it("does not return a cross-org child, and treats unbound as its own value", async () => {
    const { router, stores } = buildRouter();
    await seedSession(stores, "bound_parent", { orgId: "acme" });
    await seedSession(stores, "same_org", {
      parentSessionId: "bound_parent",
      orgId: "acme"
    });
    await seedSession(stores, "other_org", {
      parentSessionId: "bound_parent",
      orgId: "globex"
    });
    // The case a plain equality predicate silently drops.
    await seedSession(stores, "unbound_child", { parentSessionId: "bound_parent" });

    expect((await children(router, "bound_parent")).map((r) => r.id)).toEqual([
      "same_org"
    ]);

    // An unbound child under an unbound parent IS returned — the NULL-safe
    // half, and the one an equality predicate gets wrong in the other
    // direction.
    await seedSession(stores, "unbound_parent");
    await seedSession(stores, "unbound_kid", { parentSessionId: "unbound_parent" });
    expect((await children(router, "unbound_parent")).map((r) => r.id)).toEqual([
      "unbound_kid"
    ]);
  });

  it("keeps two tenants' colliding child ids apart, status included", async () => {
    const { router, stores } = buildRouter();
    for (const tenant of ["acme", "globex"]) {
      await seedSession(stores, `${tenant}:parent`, { tenantId: tenant });
      await seedSession(stores, `${tenant}:child`, {
        tenantId: tenant,
        parentSessionId: "parent"
      });
    }
    // One bare child id, two tenants, disagreeing statuses.
    await seedRequest(stores, {
      sessionId: "child",
      tenantId: "acme",
      status: "completed"
    });
    await seedRequest(stores, {
      sessionId: "child",
      tenantId: "globex",
      status: "failed"
    });

    const acme = await children(router, "parent", {
      headers: { "x-tenant-id": "acme" }
    });
    const globex = await children(router, "parent", {
      headers: { "x-tenant-id": "globex" }
    });
    expect(acme).toEqual([expect.objectContaining({ id: "child", status: "completed" })]);
    expect(globex).toEqual([expect.objectContaining({ id: "child", status: "failed" })]);
  });

  it("404s a parent that exists in another tenant", async () => {
    const { router, stores } = buildRouter();
    await seedSession(stores, "acme:parent", { tenantId: "acme" });

    const res = await call(router, ["sessions", "parent", "children"], {
      headers: { "x-tenant-id": "globex" }
    });
    // Indistinguishable from absent.
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Status — decision 4, 4a, 4b
// ---------------------------------------------------------------------------

/** Seed a parent with one child, then whatever runs the case needs. */
async function withChild(): Promise<{ router: Router; stores: StoreRegistry }> {
  const built = buildRouter();
  await seedSession(built.stores, "parent");
  await seedSession(built.stores, "child", { parentSessionId: "parent" });
  return built;
}

async function statusOf(router: Router): Promise<string | undefined> {
  const [row] = await children(router, "parent");
  return row.status;
}

describe("status — decision 4", () => {
  it("reports absence, not a status, for a child with no runs", async () => {
    const { router } = await withChild();
    const [row] = await children(router, "parent");
    // Absence is not a status, and is deliberately not defaulted to anything.
    expect("status" in row).toBe(false);
  });

  /**
   * Each status asserted individually rather than as a set — a loop over the
   * union hides which member is misclassified.
   */
  it.each([
    ["in_progress", "active"],
    ["suspended", "active"],
    ["interrupted", "active"],
    ["completed", "completed"],
    ["failed", "failed"],
    ["incomplete", "incomplete"],
    ["aborted", "aborted"]
  ] as const)("a lone %s run reads %s", async (stored, expected) => {
    const { router, stores } = await withChild();
    await seedRequest(stores, { sessionId: "child", status: stored });
    expect(await statusOf(router)).toBe(expected);
  });

  /**
   * A request is persisted `in_progress` at enqueue, before any worker picks
   * it up, and detached work *is* the queued path. This row is why the value
   * is `active` rather than `running` — the earlier design reported *running*
   * here and claimed a worker was on the job.
   */
  it("a queued-only child reads active, not running", async () => {
    const { router, stores } = await withChild();
    await seedRequest(stores, { sessionId: "child", status: "in_progress" });
    const status = await statusOf(router);
    expect(status).toBe("active");
    expect(status).not.toBe("running");
  });

  /**
   * The overlapping-run case. R1 starts, R2 starts and completes, R1 is still
   * live. A single ordered read reports `completed` here; the existence check
   * cannot, whatever the order.
   */
  it("reads active while any run is live, even behind a newer completed one", async () => {
    const { router, stores } = await withChild();
    await seedRequest(stores, {
      id: "req_r1",
      sessionId: "child",
      status: "in_progress",
      startedAtMs: 1_000
    });
    await seedRequest(stores, {
      id: "req_r2",
      sessionId: "child",
      status: "completed",
      startedAtMs: 2_000
    });
    expect(await statusOf(router)).toBe("active");
  });

  it("never puts a non-terminal request status on the wire", async () => {
    const { router, stores } = await withChild();
    for (const status of ["in_progress", "suspended", "interrupted"] as const) {
      await seedRequest(stores, { sessionId: "child", status });
      expect(await statusOf(router)).toBe("active");
    }
  });

  /**
   * `active` is opaque and carries no sub-state. An implementer helpfully
   * encoding *running* / *waiting* into it would make the anticipated
   * sub-status axis a breaking change instead of an additive one.
   */
  it("carries active as a single opaque value with no accompanying detail", async () => {
    const { router, stores } = await withChild();
    await seedRequest(stores, { sessionId: "child", status: "suspended" });
    const [row] = await children(router, "parent");
    expect(row.status).toBe("active");
    expect(Object.keys(row).filter((k) => k.toLowerCase().includes("status"))).toEqual(
      ["status"]
    );
  });
});

describe("status — decision 4a, the terminal reduction", () => {
  /**
   * The assertion that fails against pure severity precedence — the cheaper
   * alternative the decision names and rejects. A row that reads `failed`
   * forever after the failure was fixed is an alarm the user cannot clear.
   */
  it("a child that failed and was retried successfully reads completed", async () => {
    const { router, stores } = await withChild();
    await seedRequest(stores, {
      id: "req_first",
      sessionId: "child",
      status: "failed",
      startedAtMs: 1_000
    });
    await seedRequest(stores, {
      id: "req_retry",
      sessionId: "child",
      status: "completed",
      startedAtMs: 2_000
    });
    expect(await statusOf(router)).toBe("completed");
  });

  /**
   * Four tied runs, not two: a two-row tie passes against a windowed read that
   * a wider tie would truncate. The answer is the highest id, and it is the
   * same on a repeated read. Deliberately *not* asserted across adapters —
   * request ids are caller-supplied and collation genuinely differs.
   */
  it("resolves a four-way same-millisecond tie to the highest id, stably", async () => {
    const { router, stores } = await withChild();
    await seedRequest(stores, {
      id: "req_a",
      sessionId: "child",
      status: "completed",
      startedAtMs: 5_000
    });
    await seedRequest(stores, {
      id: "req_d",
      sessionId: "child",
      status: "failed",
      startedAtMs: 5_000
    });
    await seedRequest(stores, {
      id: "req_b",
      sessionId: "child",
      status: "completed",
      startedAtMs: 5_000
    });
    await seedRequest(stores, {
      id: "req_c",
      sessionId: "child",
      status: "completed",
      startedAtMs: 5_000
    });

    // `req_d` is the highest id and it failed — so the tie resolves to
    // `failed` here, and would resolve to `completed` had the failing run
    // sorted lower. Either is accepted; what is asserted is that it does not
    // move between reads.
    const first = await statusOf(router);
    const second = await statusOf(router);
    expect(first).toBe("failed");
    expect(second).toBe(first);
  });

  it("returns every terminal outcome as-is, collapsing none", async () => {
    const { router, stores } = buildRouter();
    await seedSession(stores, "parent");
    const outcomes = ["completed", "failed", "incomplete", "aborted"] as const;
    for (const outcome of outcomes) {
      await seedSession(stores, `child_${outcome}`, { parentSessionId: "parent" });
      await seedRequest(stores, { sessionId: `child_${outcome}`, status: outcome });
    }

    const rows = await children(router, "parent");
    expect(
      Object.fromEntries(rows.map((r) => [r.id, r.status]))
    ).toEqual({
      child_completed: "completed",
      child_failed: "failed",
      child_incomplete: "incomplete",
      // Collapsing this into `failed` would tell a customer their work broke
      // when they themselves cancelled it.
      child_aborted: "aborted"
    });
  });

  /**
   * The table above proves each terminal status reaches the wire correctly
   * *today*. This pins what has to keep being true: the map's domain is
   * exactly the terminal statuses.
   *
   * The map exists instead of `status as ChildSessionStatus` because a cast
   * asserts the two unions are 1:1 once, at author time, and then forwards
   * whatever ships next straight to clients. Adding a terminal member to
   * `RequestStatus` is now a compile error on this map — verified by adding
   * one and watching `tsc` reject it — and this assertion is what fails if a
   * later edit answers that error by widening the wire union reflexively
   * rather than deciding what the new status should read as.
   *
   * Asserted as a whole table rather than per key: a per-key lookup passes
   * happily while an unreviewed fifth entry sits beside it.
   */
  it("maps exactly the four terminal statuses, each to itself", () => {
    expect(TERMINAL_WIRE_STATUS).toEqual({
      completed: "completed",
      failed: "failed",
      incomplete: "incomplete",
      aborted: "aborted"
    });
  });
});

describe("status — decision 4b, when interrupted is live", () => {
  /**
   * The supersession pair, which needs both halves: (i) passes under a flatly
   * non-terminal `interrupted`, (ii) passes under a flatly terminal one, and
   * only the pair pins recency as the discriminator.
   */
  it("an interrupted run alone reads active — nothing superseded it", async () => {
    const { router, stores } = await withChild();
    await seedRequest(stores, {
      id: "req_crashed",
      sessionId: "child",
      status: "interrupted",
      startedAtMs: 1_000
    });
    // Still continuable under the same id; reporting a terminal outcome here
    // would tell the user their stalled work had finished.
    expect(await statusOf(router)).toBe("active");
  });

  /**
   * The assertion this whole classification turns on. A design that classifies
   * `interrupted` as non-terminal reads `active` here forever, and nothing
   * else in the suite catches it.
   */
  it("interrupted then retried to success reads completed", async () => {
    const { router, stores } = await withChild();
    await seedRequest(stores, {
      id: "req_crashed",
      sessionId: "child",
      status: "interrupted",
      startedAtMs: 1_000
    });
    // Exactly what `/retry` produces: a fresh record, the original untouched.
    await seedRequest(stores, {
      id: "req_retry",
      sessionId: "child",
      status: "completed",
      startedAtMs: 2_000
    });
    expect(await statusOf(router)).toBe("completed");
  });

  it("interrupted with the retry still running reads active on the retry's own record", async () => {
    const { router, stores } = await withChild();
    await seedRequest(stores, {
      id: "req_crashed",
      sessionId: "child",
      status: "interrupted",
      startedAtMs: 1_000
    });
    await seedRequest(stores, {
      id: "req_retry",
      sessionId: "child",
      status: "in_progress",
      startedAtMs: 2_000
    });
    expect(await statusOf(router)).toBe("active");
  });

  /** The accepted false negative, pinned so it is visible rather than discovered. */
  it("an old interrupted run behind an unrelated newer completed one reads completed", async () => {
    const { router, stores } = await withChild();
    await seedRequest(stores, {
      id: "req_old",
      sessionId: "child",
      status: "interrupted",
      startedAtMs: 1_000
    });
    await seedRequest(stores, {
      id: "req_unrelated",
      sessionId: "child",
      status: "completed",
      startedAtMs: 9_000
    });
    // Recency cannot tell an unrelated successor from a retry. Bounded, and
    // the run is still visible on hop 2.
    expect(await statusOf(router)).toBe("completed");
  });

  /**
   * A crashed worker keeps reading `active` after reclamation rewrites the
   * record — the assertion that fails against a flatly terminal `interrupted`,
   * which would tell the user stalled work had finished.
   */
  it("stays active across reclamation rewriting in_progress to interrupted", async () => {
    const { router, stores } = await withChild();
    await seedRequest(stores, {
      id: "req_crashed",
      sessionId: "child",
      status: "in_progress",
      startedAtMs: 1_000
    });
    expect(await statusOf(router)).toBe("active");

    const record = await stores.request.get("req_crashed");
    await stores.request.set(
      "req_crashed",
      { ...(record as RequestRecord), status: "interrupted" },
      "any"
    );
    expect(await statusOf(router)).toBe("active");
  });

  /**
   * A job paused at an approval gate is a claim on the *user*, which no other
   * run discharges — so `suspended` is exempt from the recency test that
   * `interrupted` is subject to. Hiding a pending approval behind a newer
   * completed run would be the worse error.
   */
  it("a suspended run keeps the row active even behind a newer completed run", async () => {
    const { router, stores } = await withChild();
    await seedRequest(stores, {
      id: "req_gate",
      sessionId: "child",
      status: "suspended",
      startedAtMs: 1_000
    });
    await seedRequest(stores, {
      id: "req_later",
      sessionId: "child",
      status: "completed",
      startedAtMs: 2_000
    });
    expect(await statusOf(router)).toBe("active");
  });
});

describe("status — the two reads are not atomic", () => {
  /**
   * A run enqueued after read 1 returns empty and before read 2 executes.
   * Two assertions, because two different wrong designs each fail only one:
   * emitting read 2's row as-is puts `in_progress` on the wire, and filtering
   * read 2 to terminal statuses reports a stale outcome while work is active.
   */
  it("a run enqueued between the reads reads active, never in_progress", async () => {
    const { router, stores } = await withChild();
    await seedRequest(stores, {
      id: "req_done",
      sessionId: "child",
      status: "completed",
      startedAtMs: 1_000
    });

    // Drive the interleave deliberately: insert a live run after the existence
    // check has come back empty and before the most-recent read runs.
    const realList = stores.request.list.bind(stores.request);
    let calls = 0;
    stores.request.list = async (options) => {
      const result = await realList(options);
      calls += 1;
      if (calls === 1) {
        await seedRequest(stores, {
          id: "req_new",
          sessionId: "child",
          status: "in_progress",
          startedAtMs: 5_000
        });
      }
      return result;
    };

    const status = await statusOf(router);
    expect(status).toBe("active");
    expect(status).not.toBe("in_progress");
    expect(status).not.toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// Paging and the bounds (spec §7 rule 2b, §9)
// ---------------------------------------------------------------------------

describe("paging", () => {
  async function seedChildren(stores: StoreRegistry, count: number): Promise<void> {
    await seedSession(stores, "parent");
    for (let i = 0; i < count; i++) {
      await seedSession(stores, `child_${i}`, {
        parentSessionId: "parent",
        // Distinct, ascending creation times so the page order is definite.
        createdAt: 1_000 + i,
        updatedAt: 1_000 + i
      });
    }
  }

  /**
   * The assertion that fails against the shipped `updatedAt` ordering, and the
   * one a caller can never detect. A run starting rewrites the child session's
   * `updatedAt`, so under that ordering the child jumps to the front, one
   * neighbour is silently lost and another is returned twice.
   *
   * Deliberately not a fixture of equal timestamps read twice — that passes on
   * a static set and never exercises the mutation, which is the actual defect.
   */
  it("every child appears exactly once when a run starts mid-walk", async () => {
    const { router, stores } = buildRouter();
    await seedChildren(stores, 6);

    const page1 = await children(router, "parent", { query: "limit=3" });
    expect(page1).toHaveLength(3);

    // A child from page 2 starts a run: the session record's `updatedAt` is
    // rewritten, exactly as `runAction` does when it stamps `latestRequestId`.
    const moved = await stores.session.get("child_1");
    await stores.session.set(
      "child_1",
      { ...(moved as SessionRecord), latestRequestId: "req_x", updatedAt: Date.now() },
      "any"
    );

    const page2 = await children(router, "parent", { query: "limit=3&offset=3" });
    const seen = [...page1, ...page2].map((r) => r.id);
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
  });

  /**
   * The documented exception: insertion is not closed. Assert the call
   * succeeds and does *not* error — and deliberately do not assert
   * exactly-once, because pinning it either way would make the weakening
   * invisible.
   */
  it("tolerates a child created mid-walk", async () => {
    const { router, stores } = buildRouter();
    await seedChildren(stores, 6);

    await children(router, "parent", { query: "limit=3" });
    await seedSession(stores, "child_new", {
      parentSessionId: "parent",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const res = await call(router, ["sessions", "parent", "children"], {
      query: "limit=3&offset=3"
    });
    expect(res.status).toBe(200);
  });

  it("orders newest-created first", async () => {
    const { router, stores } = buildRouter();
    await seedChildren(stores, 3);
    expect((await children(router, "parent")).map((r) => r.id)).toEqual([
      "child_2",
      "child_1",
      "child_0"
    ]);
  });

  it("applies a server-side default when limit is omitted", async () => {
    const { router, stores } = buildRouter();
    await seedChildren(stores, 30);
    // An omitted `limit` must not become an unbounded read — this endpoint is
    // polled per conversation.
    expect(await children(router, "parent")).toHaveLength(25);
  });

  it.each([
    ["limit=0", "limit"],
    ["limit=101", "limit"],
    ["limit=abc", "limit"],
    ["offset=10001", "offset"],
    ["offset=-1", "offset"]
  ])("400s on %s rather than clamping silently", async (query, name) => {
    const { router, stores } = buildRouter();
    await seedChildren(stores, 3);

    const res = await call(router, ["sessions", "parent", "children"], { query });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(name);
  });

  it("takes the ceiling straight from the public constructor", async () => {
    // Passed as an object literal rather than the spread the neighbouring
    // tests use, so this reads the way a host actually writes it.
    //
    // It does NOT prove the option is *declared* on
    // `CreateFlowApiRouterOptions`: this package typechecks `src/**/*` only,
    // so no excess-property check ever runs over this file, and an undeclared
    // option would reach the runtime here while being unsettable by any host
    // writing normal TypeScript. That half is guarded by review, not by CI.
    const registry = createFlowRegistry();
    registry.register(openFlow("chat"));
    const stores = createInMemoryStores();
    const router = createFlowApiRouter({
      registry,
      stores,
      maxChildSessionListLimit: 500
    });

    await seedChildren(stores, 3);
    const res = await call(router, ["sessions", "parent", "children"], {
      query: "limit=500"
    });
    expect(res.status).toBe(200);
  });

  it.each([
    ["Infinity", Number.POSITIVE_INFINITY],
    ["NaN", Number.NaN],
    ["zero", 0],
    ["a negative", -1],
    ["a fraction", 2.5]
  ])("refuses %s as a ceiling at construction", (_label, value) => {
    // Every one of these fails in the direction that looks like it worked:
    // Infinity and NaN make the bound comparison vacuous, so the cap is gone
    // rather than set. NaN is what `Number(process.env.X)` yields from a typo.
    const registry = createFlowRegistry();
    registry.register(openFlow("chat"));
    expect(() =>
      createFlowApiRouter({
        registry,
        stores: createInMemoryStores(),
        maxChildSessionListLimit: value
      })
    ).toThrow(/maxChildSessionListLimit/);
  });

  it("accepts a limit above the built-in ceiling when the host raises it", async () => {
    // The list is all-time history, so a deployment running large
    // orchestrations outgrows any fixed ceiling. Raising it is the operator's
    // call because the cost is per row and per read.
    const { router, stores } = buildRouter(undefined, {
      maxChildSessionListLimit: 500
    });
    await seedChildren(stores, 3);

    const res = await call(router, ["sessions", "parent", "children"], {
      query: "limit=500"
    });
    expect(res.status).toBe(200);
  });

  it("still rejects past the host's own raised ceiling", async () => {
    // Raised, not removed — an unbounded read of this endpoint is never on.
    const { router, stores } = buildRouter(undefined, {
      maxChildSessionListLimit: 500
    });
    await seedChildren(stores, 3);

    const res = await call(router, ["sessions", "parent", "children"], {
      query: "limit=501"
    });
    expect(res.status).toBe(400);
  });

  it("clamps the omitted-limit default to a ceiling lowered below it", async () => {
    // A host can tighten as well as loosen. Left unclamped the default page
    // would exceed that host's own stated maximum.
    const { router, stores } = buildRouter(undefined, {
      maxChildSessionListLimit: 10
    });
    await seedChildren(stores, 30);

    expect(await children(router, "parent")).toHaveLength(10);
  });

  it("accepts the boundary values", async () => {
    const { router, stores } = buildRouter();
    await seedChildren(stores, 3);
    expect(
      (await call(router, ["sessions", "parent", "children"], { query: "limit=100" }))
        .status
    ).toBe(200);
    expect(
      (
        await call(router, ["sessions", "parent", "children"], {
          query: "offset=10000"
        })
      ).status
    ).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Provenance — read here, written by the dispatch path
// ---------------------------------------------------------------------------

describe("provenance", () => {
  /**
   * The relationship a caller reads is carried on two server-written records:
   * the child session records its parent, and the child request records which
   * task it ran. This route reads the result and pins it; nothing here writes
   * either.
   */
  it("a server-stamped source and task id survive to the requests endpoint", async () => {
    const { router, stores } = await withChild();
    await seedRequest(stores, {
      id: "req_task",
      sessionId: "child",
      status: "completed",
      source: "taskboard",
      metadata: { taskId: "task_7f3" }
    });

    // Hop 1 finds the job.
    const [row] = await children(router, "parent");
    expect(row.id).toBe("child");

    // Hop 2 returns its run, provenance intact.
    const res = await call(router, ["sessions", row.id, "requests"]);
    expect(res.status).toBe(200);
    const { requests } = (await res.json()) as { requests: RequestRecord[] };
    expect(requests).toHaveLength(1);
    expect(requests[0]!.source).toBe("taskboard");
    expect(requests[0]!.metadata).toEqual({ taskId: "task_7f3" });
  });

  /**
   * The negative half. Caller-written metadata comes back as data and is not
   * treated as provenance by anything — in particular it does not become a
   * row's label, and it does not move a row's status.
   */
  it("caller-written metadata is returned as data and labels nothing", async () => {
    const { router, stores } = await withChild();
    await seedRequest(stores, {
      id: "req_ordinary",
      sessionId: "child",
      status: "completed",
      source: "http",
      metadata: { taskId: "task_forged", topic: "not-a-label" }
    });

    const [row] = await children(router, "parent");
    expect(row.topic).toBeUndefined();
    expect(row.coordinate).toBeUndefined();

    const { requests } = (await (
      await call(router, ["sessions", "child", "requests"])
    ).json()) as { requests: RequestRecord[] };
    expect(requests[0]!.metadata).toEqual({
      taskId: "task_forged",
      topic: "not-a-label"
    });
  });
});

// ---------------------------------------------------------------------------
// Read bounds (spec §7 rule 3)
// ---------------------------------------------------------------------------

describe("read bounds", () => {
  /**
   * The status read scales with the page, not the parent — and counting reads
   * is not enough, because that would pass while each read returned an entire
   * history. Assert the bound *on* each read as well as their number.
   */
  it("reads the request store per page row, and never asks for a history", async () => {
    const { router, stores } = buildRouter();
    await seedSession(stores, "parent");
    for (let i = 0; i < 10; i++) {
      await seedSession(stores, `child_${i}`, {
        parentSessionId: "parent",
        createdAt: 1_000 + i,
        updatedAt: 1_000 + i
      });
      for (let r = 0; r < 5; r++) {
        await seedRequest(stores, {
          sessionId: `child_${i}`,
          status: "completed",
          startedAtMs: 2_000 + r
        });
      }
    }

    const realList = stores.request.list.bind(stores.request);
    const seen: Array<{ limit?: number; orderBy?: string }> = [];
    stores.request.list = async (options) => {
      seen.push({ limit: options?.limit, orderBy: options?.orderBy });
      return realList(options);
    };

    await children(router, "parent", { query: "limit=3" });

    // Three rows, at most two reads each — bounded by the page, not by the
    // parent's ten children.
    expect(seen.length).toBeLessThanOrEqual(6);
    // And every read is bounded to one record: neither may ask for a child's
    // history.
    expect(seen.every((s) => s.limit === 1)).toBe(true);
    // The existence check is issued unordered — a sort on it is the unbounded
    // regression the mode exists to prevent.
    expect(seen.some((s) => s.orderBy === "none")).toBe(true);
  });
});
