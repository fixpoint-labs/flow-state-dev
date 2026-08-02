/**
 * POC (throwaway — FIX-939 design, not a shipping test).
 *
 * Exercises the proposed sub-session model against the REAL in-memory stores:
 *
 *   - a sub-session carries `parentSessionId`, `boardId`, `assignee`, `topic`
 *   - tasks route by (tenantId, parentSessionId, boardId, assignee, topic),
 *     get-or-create
 *   - lineage-derived affinity and key-based routing must converge on one session
 *
 * Specifically settles whether get-or-create is safe under concurrent dispatch.
 * It is not, and it takes TWO changes rather than one: the session id must be
 * derived from the routing coordinates (so racing callers target one key) AND
 * the store must offer a create-if-absent insert (so one of them loses). Either
 * alone still ends with a broken uniqueness guarantee — measured below.
 */
import { describe, expect, it } from "vitest";
import { InMemorySessionStore } from "../src/stores/memory/session-store";
import { InMemoryRequestStore } from "../src/stores/memory/request-store";
import type { RequestRecord, SessionRecord } from "../src/stores/types";

/** The fields the design would add to SessionRecord. */
type Workstream = SessionRecord & {
  parentSessionId?: string;
  boardId?: string;
  assignee?: string;
  topic?: string;
};

/**
 * `tenantId` leads the key. Session record ids are already tenant-namespaced and
 * every history read exact-matches the tenant (FIX-682); a Workstream key that
 * omits it would alias two tenants that reuse the same caller-chosen parent
 * session id, board, assignee and topic — handing one tenant another's child
 * session and history.
 */
const TENANT_A = "tenant_a";
const TENANT_B = "tenant_b";
const BOARD_A = "board_research";
const BOARD_B = "board_delivery";

const WORKER_FLOW = "worker";
const PARENT_FLOW = "epic";

type Key = {
  tenantId: string;
  parentSessionId: string;
  boardId: string;
  assignee: string;
  topic: string;
};

function makeParent(id: string, tenantId: string): Workstream {
  const ts = 1_000;
  return {
    id: `${tenantId}:${id}`,
    flowKind: PARENT_FLOW,
    userId: "u1",
    tenantId,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    journal: []
  };
}

/**
 * Production sets `SessionRecord.id` to the **storage key**, not the bare id
 * (`createExecutionContext.ts:584` — `id: sessionKey`), and later writes such as
 * `appendJournal` / `setMetadata` persist using `sessionRef.current.id`. A record
 * whose `id` is bare while its map key is namespaced would send those writes to a
 * second, bare-keyed record and leave the canonical one stale. The bare id is
 * still what a caller passes to `runAction`; it is recovered from the key.
 */
function makeWorkstream(publicId: string, k: Key): Workstream {
  const ts = 1_000;
  return {
    id: storageKey(publicId, k.tenantId),
    flowKind: WORKER_FLOW,
    userId: "u1",
    tenantId: k.tenantId,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    journal: [],
    parentSessionId: k.parentSessionId,
    boardId: k.boardId,
    assignee: k.assignee,
    topic: k.topic
  };
}

/**
 * `SessionListOptions` has no `parentSessionId` or `topic` filter today
 * (flowKind / userId / tenantId / limit only), so the lookup scans and filters
 * in memory. That scan is exactly the filter the adapters would need.
 *
 * Keyed on `(parentSessionId, flowKind, topic)` — `SessionRecord.flowKind` binds
 * a session to a flow at creation, so topic alone can return a Workstream whose
 * flow lacks the action being dispatched.
 */
async function findWorkstream(
  store: InMemorySessionStore,
  k: Key
): Promise<Workstream | undefined> {
  // Tenant filtering happens at the STORE, matching how every history read is
  // scoped today — not as an in-memory afterthought.
  const all = (await store.list({ tenantId: k.tenantId })) as Workstream[];
  return all.find(
    (s) =>
      s.parentSessionId === k.parentSessionId &&
      s.boardId === k.boardId &&
      s.assignee === k.assignee &&
      s.topic === k.topic
  );
}

let seq = 0;
/** The naive path: a fresh opaque id per create. Kept only to measure its race. */
const nextId = () => `sess_generated_${++seq}`;

/**
 * The Workstream's public session id, DERIVED from the four caller coordinates
 * rather than generated.
 *
 * This is the half N5's `"absent"` sentinel does not supply. A create-if-absent
 * insert can only reject a second writer that aims at the SAME key; two callers
 * racing get-or-create with `nextId()` aim at two different keys, so both
 * inserts succeed and the uniqueness guarantee is still broken. Deriving the id
 * collapses both callers onto one key, which is the precondition the sentinel
 * needs.
 *
 * `tenantId` is deliberately NOT in the derivation: the record is persisted at
 * `${tenantId}:${id}` (`resolveSessionStorageKey`), so the tenant already
 * separates two derivations that agree on all four coordinates. Adding it to
 * the id as well would be a second, parallel mechanism for the same thing, and
 * would leak the tenant into an id that callers pass to `runAction`.
 *
 * `encodeURIComponent` is what makes the encoding canonical — session ids
 * already carry a "must not contain `:` ambiguously" caveat
 * (`scope-keys.ts:69-71`), and a raw join would let `topic: "a:b"` and
 * `assignee: "a", topic: "b"` derive the same id. If FIX-982 finds the length
 * unacceptable for a key column, a hash over this same canonical encoding has
 * the identical collision properties and loses only debuggability.
 */
const deriveWorkstreamId = (k: Key) =>
  `ws_${[k.parentSessionId, k.boardId, k.assignee, k.topic].map(encodeURIComponent).join(":")}`;

/**
 * Mirrors `resolveSessionStorageKey` (`stores/scope-keys.ts:75-82`): the record
 * is PERSISTED under `${tenantId}:${sessionId}` while the Workstream's public id
 * stays bare, which is the id a caller hands to `runAction`. Storing under the
 * bare id — as an earlier draft did — means production lookups miss the record
 * and silently create a second session with no Workstream metadata.
 */
const storageKey = (id: string, tenantId: string | undefined) =>
  tenantId !== undefined && tenantId.length > 0 ? `${tenantId}:${id}` : id;

/** Recovers the bare id a caller hands to `runAction` from the storage key. */
const publicIdOf = (w: Workstream) =>
  w.tenantId !== undefined && w.id.startsWith(`${w.tenantId}:`)
    ? w.id.slice(w.tenantId.length + 1)
    : w.id;

async function getOrCreateWorkstream(
  store: InMemorySessionStore,
  k: Key,
  idOf: (k: Key) => string = deriveWorkstreamId
): Promise<Workstream> {
  const existing = await findWorkstream(store, k);
  if (existing !== undefined) return existing;
  const created = makeWorkstream(idOf(k), k);
  // Record id === map key, exactly as production writes it.
  await store.set(created.id, created, "any");
  return created;
}

/** Convenience for the common single-tenant, single-board case. */
const key = (over: Partial<Key> = {}): Key => ({
  tenantId: TENANT_A,
  parentSessionId: "S",
  boardId: BOARD_A,
  assignee: "implementer",
  topic: "FIX-981",
  ...over
});

/**
 * `RequestRecord.sessionId` holds the **bare** id, not the namespaced storage
 * key — `runAction.ts:618` writes `options.sessionId` verbatim, and the tenant
 * rides alongside it in its own field (`:621`). The cross-turn history read
 * then passes both separately (`createExecutionContext.ts:527-531`). Writing
 * the storage key into `sessionId` — as an earlier draft of this POC did —
 * would make the evidence pass for the wrong reason: the namespace, rather than
 * the tenant filter, would be doing the isolating, and the tenant dimension of
 * the read would never be exercised at all.
 */
function makeCompletedRequest(
  id: string,
  sessionId: string,
  startedAtMs: number,
  tenantId: string | undefined
): RequestRecord {
  return {
    id,
    flowKind: "epic",
    actionName: "work",
    userId: "u1",
    sessionId,
    tenantId,
    status: "completed",
    startedAtMs,
    state: {},
    version: 0,
    createdAt: startedAtMs,
    updatedAt: startedAtMs,
    items: []
  } as RequestRecord;
}

describe("POC: workstream routing via (tenantId, parentSessionId, boardId, assignee, topic)", () => {
  async function freshStore() {
    const store = new InMemorySessionStore();
    await store.set(`${TENANT_A}:S`, makeParent("S", TENANT_A), "any");
    await store.set(`${TENANT_B}:S`, makeParent("S", TENANT_B), "any");
    return store;
  }

  it("routes two independent callers to the SAME workstream", async () => {
    const store = await freshStore();
    const first = await getOrCreateWorkstream(store, key());
    const second = await getOrCreateWorkstream(store, key());
    expect(second.id).toBe(first.id);
  });

  it("keeps separate topics in separate workstreams", async () => {
    const store = await freshStore();
    const a = await getOrCreateWorkstream(store, key({ topic: "FIX-981" }));
    const b = await getOrCreateWorkstream(store, key({ topic: "FIX-982" }));
    expect(a.id).not.toBe(b.id);
  });

  it("assignee is part of the key — one topic, two workers", async () => {
    const store = await freshStore();
    const research = await getOrCreateWorkstream(store, key({ assignee: "researcher" }));
    const implement = await getOrCreateWorkstream(store, key({ assignee: "implementer" }));
    expect(research.id).not.toBe(implement.id);
    expect((await getOrCreateWorkstream(store, key({ assignee: "researcher" }))).id).toBe(research.id);
  });

  it("boardId is part of the key — two boards, same assignee and topic", async () => {
    const store = await freshStore();
    const a = await getOrCreateWorkstream(store, key({ boardId: BOARD_A }));
    const b = await getOrCreateWorkstream(store, key({ boardId: BOARD_B }));
    expect(a.id).not.toBe(b.id);
  });

  it("TENANT — two tenants reusing every other coordinate do NOT alias", async () => {
    const store = await freshStore();
    const a = await getOrCreateWorkstream(store, key({ tenantId: TENANT_A }));
    const b = await getOrCreateWorkstream(store, key({ tenantId: TENANT_B }));

    expect(a.id).not.toBe(b.id);
    expect(a.tenantId).toBe(TENANT_A);
    expect(b.tenantId).toBe(TENANT_B);

    // Everything BUT the tenant is identical — the 4-part key would have aliased.
    const fourPart = (w: Workstream) =>
      `${w.parentSessionId}|${w.boardId}|${w.assignee}|${w.topic}`;
    expect(fourPart(a)).toBe(fourPart(b));

    // A tenant-scoped lookup never reaches across.
    expect((await getOrCreateWorkstream(store, key({ tenantId: TENANT_A }))).id).toBe(a.id);
    expect((await getOrCreateWorkstream(store, key({ tenantId: TENANT_B }))).id).toBe(b.id);
  });

  it("STORAGE KEY — record id IS the storage key; the public id is recovered", async () => {
    const store = await freshStore();
    const ws = await getOrCreateWorkstream(store, key());

    // The record's own id is namespaced, matching `id: sessionKey` in
    // production — so later writes keyed on `sessionRef.current.id` land on the
    // canonical record rather than forking a bare-keyed duplicate.
    expect(ws.id).toBe(`${TENANT_A}:${publicIdOf(ws)}`);
    expect(await store.get(ws.id)).toBeDefined();

    // The bare id — what a caller passes to `runAction` — is recoverable, and
    // is NOT itself a storage key.
    expect(publicIdOf(ws).startsWith(`${TENANT_A}:`)).toBe(false);
    expect(await store.get(publicIdOf(ws))).toBeUndefined();
  });

  it("history stays isolated per workstream, parent untouched", async () => {
    const sessions = await freshStore();
    const requests = new InMemoryRequestStore();
    const ws981 = await getOrCreateWorkstream(sessions, key({ topic: "FIX-981" }));
    const ws982 = await getOrCreateWorkstream(sessions, key({ topic: "FIX-982" }));

    // Bare ids in `sessionId`, tenant in its own field — production's shape.
    const p981 = publicIdOf(ws981);
    const p982 = publicIdOf(ws982);
    await requests.set("r_parent", makeCompletedRequest("r_parent", "S", 1, TENANT_A), "any");
    await requests.set("r_981_a", makeCompletedRequest("r_981_a", p981, 2, TENANT_A), "any");
    await requests.set("r_981_b", makeCompletedRequest("r_981_b", p981, 3, TENANT_A), "any");
    await requests.set("r_982_a", makeCompletedRequest("r_982_a", p982, 4, TENANT_A), "any");

    // Verbatim shape of the cross-turn read: bare session id + explicit tenant.
    const load = (sessionId: string, tenantId: string | undefined) =>
      requests.list({
        sessionId,
        tenantId,
        status: "completed",
        limit: 50,
        orderBy: "startedAtMs"
      });

    expect((await load("S", TENANT_A)).map((r) => r.id)).toEqual(["r_parent"]);
    expect((await load(p981, TENANT_A)).map((r) => r.id).sort()).toEqual(["r_981_a", "r_981_b"]);
    expect((await load(p982, TENANT_A)).map((r) => r.id)).toEqual(["r_982_a"]);
  });

  it("TENANT — two tenants derive the SAME bare id; only the read's tenant separates them", async () => {
    const sessions = await freshStore();
    const requests = new InMemoryRequestStore();
    const a = await getOrCreateWorkstream(sessions, key({ tenantId: TENANT_A }));
    const b = await getOrCreateWorkstream(sessions, key({ tenantId: TENANT_B }));

    // This is N8's aliasing hazard made concrete rather than assumed away: with
    // a derived id the two tenants' Workstreams carry the SAME bare session id,
    // which is exactly the id that lands in `RequestRecord.sessionId`. Nothing
    // about the id distinguishes them.
    expect(publicIdOf(a)).toBe(publicIdOf(b));
    const bare = publicIdOf(a);

    await requests.set("r_a", makeCompletedRequest("r_a", bare, 1, TENANT_A), "any");
    await requests.set("r_b", makeCompletedRequest("r_b", bare, 2, TENANT_B), "any");

    const load = (tenantId: string | undefined) =>
      requests.list({ sessionId: bare, tenantId, status: "completed", limit: 50 });

    // The tenant filter — and only the tenant filter — keeps them apart.
    expect((await load(TENANT_A)).map((r) => r.id)).toEqual(["r_a"]);
    expect((await load(TENANT_B)).map((r) => r.id)).toEqual(["r_b"]);

    // Omitting it hands one tenant the other's turns. `matchesTenantFilter`
    // short-circuits when the key is absent (`scope-keys.ts:131`), so a
    // detached-dispatch path that forgets to thread the tenant does not fail
    // loudly — it silently widens.
    const leaked = await requests.list({ sessionId: bare, status: "completed", limit: 50 });
    expect(leaked.map((r) => r.id).sort()).toEqual(["r_a", "r_b"]);
  });

  it("the tree query works — children of a parent, within one tenant", async () => {
    const store = await freshStore();
    await getOrCreateWorkstream(store, key({ topic: "FIX-981" }));
    await getOrCreateWorkstream(store, key({ topic: "FIX-982" }));
    await getOrCreateWorkstream(store, key({ tenantId: TENANT_B, topic: "FIX-999" }));

    const mine = (await store.list({ tenantId: TENANT_A })) as Workstream[];
    const children = mine.filter((s) => s.parentSessionId === "S");
    expect(children.map((s) => s.topic).sort()).toEqual(["FIX-981", "FIX-982"]);
  });

  it("RACE — with a GENERATED id, concurrent get-or-create creates DUPLICATE workstreams", async () => {
    const store = await freshStore();
    const [a, b] = await Promise.all([
      getOrCreateWorkstream(store, key(), nextId),
      getOrCreateWorkstream(store, key(), nextId)
    ]);
    const all = (await store.list({ tenantId: TENANT_A })) as Workstream[];
    const dupes = all.filter((s) => s.topic === "FIX-981");

    // eslint-disable-next-line no-console
    console.log(
      `[poc] generated-id get-or-create -> distinct ids=${a.id !== b.id} ` +
        `workstreams-for-FIX-981=${dupes.length}`
    );
    expect(a.id).not.toBe(b.id);
    expect(dupes).toHaveLength(2);
  });

  it("RACE — a create-if-absent sentinel does NOT fix the generated-id path", async () => {
    // The sentinel N5 proposes rejects a second insert AT THE SAME KEY. Model
    // its strongest possible form — an insert that fails whenever the key is
    // already occupied — and race it over generated ids.
    const store = await freshStore();
    const insertIfAbsent = async (k: Key) => {
      const created = makeWorkstream(nextId(), k);
      if ((await store.get(created.id)) !== undefined) return { ok: false as const };
      await store.set(created.id, created, "any");
      return { ok: true as const, created };
    };

    const [a, b] = await Promise.all([insertIfAbsent(key()), insertIfAbsent(key())]);

    // eslint-disable-next-line no-console
    console.log(
      `[poc] absent-sentinel over generated ids -> both inserts ok=${a.ok && b.ok} ` +
        `(no key ever collides, so the sentinel never fires)`
    );

    // Both succeed. The sentinel is not wrong; it is aimed at a collision that
    // a fresh id per caller guarantees will never happen.
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const dupes = ((await store.list({ tenantId: TENANT_A })) as Workstream[]).filter(
      (s) => s.topic === "FIX-981"
    );
    expect(dupes).toHaveLength(2);
  });

  it("RACE — a DERIVED id collapses both callers onto one key (the sentinel's precondition)", async () => {
    const store = await freshStore();
    const [a, b] = await Promise.all([
      getOrCreateWorkstream(store, key()),
      getOrCreateWorkstream(store, key())
    ]);

    // Derivation alone is not a fix — it converts "two sessions" into "one
    // session, last writer wins", because `set` is still an upsert (the
    // composite-id measurement below). What it buys is that the two writes now
    // TARGET THE SAME KEY, which is the only condition under which a
    // create-if-absent insert can reject one of them.
    const dupes = ((await store.list({ tenantId: TENANT_A })) as Workstream[]).filter(
      (s) => s.topic === "FIX-981"
    );

    // eslint-disable-next-line no-console
    console.log(
      `[poc] derived-id get-or-create -> same key=${a.id === b.id} ` +
        `workstreams-for-FIX-981=${dupes.length}`
    );

    expect(a.id).toBe(b.id);
    expect(dupes).toHaveLength(1);
    expect(a.id).toBe(storageKey(deriveWorkstreamId(key()), TENANT_A));
  });

  it("DERIVATION — the encoding is canonical, so no two distinct keys collide", () => {
    // A raw join would make these two keys — different assignee, different
    // topic — derive the same id, silently merging two workers' Workstreams.
    const split = deriveWorkstreamId(key({ assignee: "a", topic: "b" }));
    const joined = deriveWorkstreamId(key({ assignee: "a:b", topic: "" }));
    expect(split).not.toBe(joined);

    // ...and a separator inside a coordinate does not shift the field boundaries.
    expect(deriveWorkstreamId(key({ topic: "FIX-981:v2" }))).not.toBe(
      deriveWorkstreamId(key({ topic: "FIX-981", assignee: "implementer:v2" }))
    );
  });

  it("RACE — a composite id does NOT save you: set() is an upsert, not an insert", async () => {
    const store = new InMemorySessionStore();
    const id = `S:${BOARD_A}:implementer:FIX-981`;
    const skey = storageKey(id, TENANT_A);
    const first = await store.set(skey, makeWorkstream(id, key()), 0);
    const second = await store.set(
      skey,
      { ...makeWorkstream(id, key()), title: "second writer" },
      0
    );

    // eslint-disable-next-line no-console
    console.log(
      `[poc] composite-id create: first.ok=${first.ok} second.ok=${second.ok} ` +
        `(second should have conflicted, but did not)`
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect((await store.get(storageKey(id, TENANT_A)))?.title).toBe("second writer");
  });
});
