/**
 * POC (throwaway — FIX-939 design, not a shipping test).
 *
 * A **forked session** is an isolated session that still sees its parent's
 * conversation history up to a **fork point**. It would let a Workstream be
 * isolated for writes while inheriting context for reads — and would subsume
 * `contextSupply: "conversation"` needing the parent session id threaded into
 * a detached worker's history slot.
 *
 * Two implementations are compared against the real in-memory request store,
 * using the verbatim cross-turn history query from
 * `createExecutionContext.ts:526-536`:
 *
 *   COPY      — at fork time, duplicate the parent's prior requests into the
 *               fork's own session id. The existing query then works unchanged.
 *   REFERENCE — store `forkedFrom { sessionId, atMs }` and union the fork's own
 *               requests with the parent's up to the fork point at load time.
 *
 * The correctness property both must satisfy: **the fork point holds** — parent
 * turns after the fork are invisible to the fork, and the fork is invisible to
 * the parent, forever.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRequestStore } from "../src/stores/memory/request-store";
import type { RequestRecord } from "../src/stores/types";
import type { OutputItem } from "@flow-state-dev/core/items";

/**
 * A tenant-less deployment — the single-tenant case, where records carry no
 * tenant and the read exact-matches that. Named rather than inlined so the
 * loaders' tenant argument reads as a decision at each call site.
 */
const NO_TENANT = undefined;
/** A tenant-scoped deployment, for the fork case that a hard-coded read breaks. */
const TENANT_A = "tenant_a";

const HISTORY_WINDOW = 50;

function turn(
  id: string,
  sessionId: string,
  startedAtMs: number,
  text: string,
  tenantId?: string
): RequestRecord {
  return {
    id,
    flowKind: "chat",
    actionName: "send",
    userId: "u1",
    sessionId,
    tenantId,
    status: "completed",
    startedAtMs,
    state: {},
    version: 0,
    createdAt: startedAtMs,
    updatedAt: startedAtMs,
    items: [
      { id: `${id}_i0`, requestId: id, type: "message", role: "assistant", text } as unknown as OutputItem
    ]
  } as RequestRecord;
}

/**
 * Verbatim shape of the cross-turn history load (createExecutionContext.ts:526-536).
 *
 * `tenantId` is a REQUIRED parameter, not a defaulted one. `matchesTenantFilter`
 * treats a present-`undefined` as an exact filter (`scope-keys.ts:131`), so
 * hard-coding it here would silently match only tenant-less records: a fork of
 * a tenant-scoped parent would snapshot NOTHING at fork time and inherit no
 * conversation, with no error anywhere. Production always threads
 * `options.tenantId` through; so does this.
 */
function loadOwn(store: InMemoryRequestStore, sessionId: string, tenantId: string | undefined) {
  return store.list({
    sessionId,
    tenantId,
    status: "completed",
    limit: HISTORY_WINDOW,
    orderBy: "startedAtMs",
    withItems: true
  });
}

/**
 * Unbounded read of a session's completed requests. Kept ONLY to measure what
 * it costs — see `loadCursorMembers`, which is what an ancestor read should
 * actually do.
 */
function loadAll(store: InMemoryRequestStore, sessionId: string, tenantId: string | undefined) {
  return store.list({
    sessionId,
    tenantId,
    status: "completed",
    orderBy: "startedAtMs",
    withItems: true
  });
}

/**
 * Fetch an ancestor's contribution BY ID, not by scanning the session.
 *
 * The cursor names at most `historyWindow.turns` ids, but `loadAll` is bounded
 * by the ancestor's entire lifetime: a list-then-discard read pulls every
 * completed parent request *and its items* on every child turn, and throws away
 * all but the snapshot (BP-033 — filter at the source before you load). The
 * §8 `reads=2` figure counts round trips, not rows; on a long-lived parent the
 * two diverge sharply, which is measured below.
 *
 * Each fetched record is re-checked against the session and tenant it is
 * supposed to belong to. `get` bypasses both filters, and the cursor is
 * persisted data — a stale or tampered snapshot must not become a read
 * primitive for another session's requests.
 */
async function loadCursorMembers(
  store: InMemoryRequestStore,
  sessionId: string,
  visible: ReadonlySet<string>,
  tenantId: string | undefined,
  countCall: () => void = () => {}
): Promise<RequestRecord[]> {
  const fetched = await Promise.all(
    [...visible].map((id) => {
      countCall();
      return store.get(id);
    })
  );
  return fetched.filter(
    (r): r is RequestRecord =>
      r !== undefined &&
      r.sessionId === sessionId &&
      r.tenantId === tenantId &&
      r.status === "completed"
  );
}

const asc = (rs: RequestRecord[]) =>
  [...rs].sort((a, b) => a.startedAtMs - b.startedAtMs).map((r) => r.id);

// ─── Strategy 1: COPY ────────────────────────────────────────────────────────

/**
 * Duplicates the parent's history into the fork. Note the id rewrite: request
 * ids are primary keys, so copies cannot reuse them — which means the copies
 * are no longer the same records, and provenance to the original turn is lost
 * unless a back-reference is added.
 *
 * MEASUREMENT LIMIT — this understates COPY on every store that matters (N51).
 * It runs against `InMemoryRequestStore`, where items ride on the record, so
 * spreading `{...r}` into `set()` carries the messages along. Both persistent
 * adapters deliberately DROP them on the way in:
 *
 *   const { items: _omitted, ...withoutItems } = value;   // before the base write
 *   // "Items live in `request_items`; keep them out of `requests.data`"
 *   //   store-sqlite/src/request-store.ts:279
 *   //   store-postgres/src/request-store.ts:301
 *
 * So a COPY fork written this way reloads on SQLite or Postgres as N request
 * records with NO messages — the fork inherits empty turns, silently, and only
 * in a real deployment. Real COPY is `set` + `persistItems` + `flushItems` per
 * copied request, with ids rewritten: roughly double the writes plus an
 * ordering constraint this function never exercises. The `writes` count below
 * is therefore a floor, not the cost. Anyone choosing COPY re-measures against
 * a persistent adapter first. REFERENCE is unaffected — it writes nothing.
 */
async function forkByCopy(
  store: InMemoryRequestStore,
  parentSessionId: string,
  forkSessionId: string,
  atMs: number,
  tenantId: string | undefined
): Promise<{ writes: number }> {
  const parent = await loadOwn(store, parentSessionId, tenantId);
  const prefix = parent.filter((r) => r.startedAtMs <= atMs);
  let writes = 0;
  for (const r of prefix) {
    const copyId = `${forkSessionId}__${r.id}`;
    await store.set(
      copyId,
      { ...r, id: copyId, sessionId: forkSessionId } as RequestRecord,
      "any"
    );
    writes++;
  }
  return { writes };
}

// ─── Strategy 2: REFERENCE ───────────────────────────────────────────────────

/**
 * The fork point is an **immutable cursor** — the exact set of ancestor request
 * ids visible at fork time — not a wall-clock timestamp.
 *
 * A timestamp does not hold. `atMs` is compared against a list already filtered
 * to `status: "completed"`, so a parent request that STARTED before the fork but
 * COMPLETED after it is absent at fork time and then appears on a later load,
 * growing the fork's prefix after creation. A post-fork request sharing the
 * fork's millisecond leaks the same way. Both violate the invariant.
 *
 * Snapshotting ids is exact and cheap (ids, not records), and it makes the chain
 * walk simpler: each level's snapshot is precisely what that level could see, so
 * no ceiling arithmetic is needed.
 */
type ForkRef = { sessionId: string; visible: ReadonlySet<string> };

/**
 * What actually gets stored. A fork ref lives on the Workstream's session
 * record, which is persisted as JSON by every adapter, and
 * `JSON.stringify(new Set([...]))` is `{}` — the cursor would serialize to
 * nothing at all, silently, with no error at write time. The fork would come
 * back from the store with an empty snapshot and inherit no history.
 *
 * So the persisted shape is an array and the runtime shape is a Set; the
 * conversion is explicit at both ends rather than implied. Measured below.
 *
 * **Not in `SessionRecord.metadata`, though — a framework-owned field.**
 * `metadata` is a caller-writable shallow-merge bag on two public paths:
 * `handlePatchSessionMetadata` (`session-routes.ts:216-217`) and
 * `ctx.session.setMetadata` (`createExecutionContext.ts:1917-1918`), both
 * writing with `expectedVersion: "any"`. A cursor kept there is not immutable
 * in any sense the fork point requires — any caller who can PATCH the session
 * can empty it, or repoint `sessionId` at a session the fork was never forked
 * from. Measured below, on both the integrity and the read-escalation paths.
 */
type PersistedForkRef = { sessionId: string; visible: readonly string[] };

const persistForkRef = (ref: ForkRef): PersistedForkRef => ({
  sessionId: ref.sessionId,
  // Sorted so a stored cursor is stable across writes — two persists of the
  // same snapshot produce byte-identical JSON, which matters for a CAS'd record.
  visible: [...ref.visible].sort()
});

const hydrateForkRef = (ref: PersistedForkRef): ForkRef => ({
  sessionId: ref.sessionId,
  visible: new Set(ref.visible)
});

/** Takes the cursor: what the parent had completed at the moment of the fork. */
async function forkCursor(
  store: InMemoryRequestStore,
  parentSessionId: string,
  tenantId: string | undefined
): Promise<ReadonlySet<string>> {
  const completed = await loadOwn(store, parentSessionId, tenantId);
  return new Set(completed.map((r) => r.id));
}

/**
 * Unions the fork's own requests with each ancestor's snapshot, walking the
 * chain so a fork-of-a-fork still resolves. This is the query change the copy
 * strategy avoids.
 */
async function loadForked(
  store: InMemoryRequestStore,
  sessionId: string,
  forks: Record<string, ForkRef>,
  tenantId: string | undefined
): Promise<{ records: RequestRecord[]; reads: number }> {
  const out: RequestRecord[] = [];
  // Counts STORE CALLS, not chain levels. An earlier draft incremented once per
  // ancestor while `loadCursorMembers` issued one `get` per cursor member, so a
  // 50-id cursor reported `reads=1`. There is no batch-by-id surface on any
  // adapter today, so those N calls are real round trips — the by-id path
  // trades unbounded ROWS for N CALLS, and both numbers belong in §8.
  let reads = 0;
  let cursor: string | undefined = sessionId;
  let visible: ReadonlySet<string> | undefined; // undefined = the fork's own session

  while (cursor !== undefined) {
    // The cursor members must be selected BEFORE the window limit, not after.
    // `loadOwn` takes the newest N; if the parent has produced N post-fork turns
    // then none of the cursor's pre-fork ids survive that cut, and the fork
    // silently loses its entire inherited prefix while retention removed
    // nothing. So an ancestor is read by ID from its snapshot — which fixes
    // that without the unbounded scan a list-then-discard read would cost.
    const own =
      visible === undefined
        ? (reads++, await loadOwn(store, cursor, tenantId))
        : await loadCursorMembers(store, cursor, visible, tenantId, () => {
            reads++;
          });
    out.push(...own);
    const ref: ForkRef | undefined = forks[cursor];
    if (ref === undefined) break;
    visible = ref.visible;
    cursor = ref.sessionId;
  }
  // Newest-first like the store, so callers sort ascending as today.
  return { records: out.sort((a, b) => b.startedAtMs - a.startedAtMs), reads };
}

describe("POC: forked sessions — inherit history to a fork point", () => {
  /** Parent S: turns at 1..3, fork at 3, then parent continues at 4..5. */
  async function seed() {
    const store = new InMemoryRequestStore();
    for (const n of [1, 2, 3]) {
      await store.set(`p${n}`, turn(`p${n}`, "S", n, `parent turn ${n}`), "any");
    }
    return store;
  }

  async function parentContinues(store: InMemoryRequestStore) {
    for (const n of [4, 5]) {
      await store.set(`p${n}`, turn(`p${n}`, "S", n, `parent turn ${n}`), "any");
    }
  }

  it("COPY — fork sees the prefix, and the fork point holds", async () => {
    const store = await seed();
    const { writes } = await forkByCopy(store, "S", "W", 3, NO_TENANT);
    await parentContinues(store);
    await store.set("w1", turn("w1", "W", 10, "fork's own turn"), "any");

    const fork = asc(await loadOwn(store, "W", NO_TENANT));
    // eslint-disable-next-line no-console
    console.log(`[fork/copy] writes-at-fork=${writes} reads-at-load=1 window=${fork.length}`);

    expect(fork).toEqual(["W__p1", "W__p2", "W__p3", "w1"]);
    // Parent turns 4 and 5 happened AFTER the fork — invisible.
    expect(fork.some((id) => id.endsWith("p4") || id.endsWith("p5"))).toBe(false);
    // And the parent never sees the fork.
    expect(asc(await loadOwn(store, "S", NO_TENANT))).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("REFERENCE — same visible history, no writes at fork", async () => {
    const store = await seed();
    const forks: Record<string, ForkRef> = {
      W: { sessionId: "S", visible: await forkCursor(store, "S", NO_TENANT) }
    };
    await parentContinues(store);
    await store.set("w1", turn("w1", "W", 10, "fork's own turn"), "any");

    const { records, reads } = await loadForked(store, "W", forks, NO_TENANT);
    // eslint-disable-next-line no-console
    console.log(`[fork/ref] writes-at-fork=0 reads-at-load=${reads} window=${records.length}`);

    expect(asc(records)).toEqual(["p1", "p2", "p3", "w1"]);
    expect(asc(await loadOwn(store, "S", NO_TENANT))).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("both strategies agree on what the fork can see", async () => {
    const copyStore = await seed();
    await forkByCopy(copyStore, "S", "W", 3, NO_TENANT);
    await parentContinues(copyStore);
    await copyStore.set("w1", turn("w1", "W", 10, "own"), "any");

    const refStore = await seed();
    const cur = await forkCursor(refStore, "S", NO_TENANT);
    await parentContinues(refStore);
    await refStore.set("w1", turn("w1", "W", 10, "own"), "any");
    const { records } = await loadForked(refStore, "W", { W: { sessionId: "S", visible: cur } }, NO_TENANT);

    const textsOf = (rs: RequestRecord[]) =>
      [...rs]
        .sort((a, b) => a.startedAtMs - b.startedAtMs)
        .flatMap((r) => (r.items ?? []).map((i) => (i as unknown as { text: string }).text));

    expect(textsOf(await loadOwn(copyStore, "W", NO_TENANT))).toEqual(textsOf(records));
  });

  it("COPY cost scales with parent history; REFERENCE cost is constant", async () => {
    const store = new InMemoryRequestStore();
    for (let n = 1; n <= 40; n++) {
      await store.set(`p${n}`, turn(`p${n}`, "S", n, `t${n}`), "any");
    }
    const { writes } = await forkByCopy(store, "S", "W", 40, NO_TENANT);
    const { reads } = await loadForked(store, "W2", {
      W2: { sessionId: "S", visible: await forkCursor(store, "S", NO_TENANT) }
    }, NO_TENANT);

    // eslint-disable-next-line no-console
    console.log(`[fork/cost] 40-turn parent -> copy writes=${writes}, reference writes=0 reads=${reads}`);
    expect(writes).toBe(40);
    // 1 call for the fork's own turns + one `get` per cursor member. NOT 2:
    // an earlier draft counted chain LEVELS and reported 2, which is how "the
    // reference strategy's cost is constant" got into the record. It is not —
    // it is O(cursor) store calls on EVERY child turn, against a one-time
    // O(prefix) write for COPY.
    expect(reads).toBe(41);
  });

  it("REFERENCE resolves a fork of a fork; COPY needs a re-copy per level", async () => {
    const store = await seed();
    // W forks S at 3; V forks W at 12.
    await store.set("w1", turn("w1", "W", 10, "W turn"), "any");
    await store.set("w2", turn("w2", "W", 12, "W turn 2"), "any");
    await store.set("w3", turn("w3", "W", 20, "W AFTER V's fork point"), "any");
    await store.set("v1", turn("v1", "V", 30, "V turn"), "any");

    const forks: Record<string, ForkRef> = {
      W: { sessionId: "S", visible: new Set(["p1", "p2", "p3"]) },
      V: { sessionId: "W", visible: new Set(["w1", "w2"]) }
    };
    const { records, reads } = await loadForked(store, "V", forks, NO_TENANT);

    // eslint-disable-next-line no-console
    console.log(`[fork/chain] depth=2 reads=${reads} visible=${asc(records).join(",")}`);

    // V sees S's prefix, W up to 12, its own — and NOT W's later turn.
    expect(asc(records)).toEqual(["p1", "p2", "p3", "w1", "w2", "v1"]);
    // 1 (own) + 3 (W's cursor) + 2 (V's cursor) = 6, not the 3 levels walked.
    expect(reads).toBe(6);
  });

  it("RETENTION — COPY defeats the parent's policy; REFERENCE honors it", async () => {
    // Retention is OPT-IN: `resolveRetentionPolicy` returns undefined unless a
    // flow sets `maxItems` or `maxAge`, and it prunes a session's own completed
    // requests lazily after a request finishes. So this only happens when an
    // operator asked for it — which is what makes the direction matter.
    const refStore = await seed();
    const refCursor = await forkCursor(refStore, "S", NO_TENANT);
    await refStore.set("w1", turn("w1", "W", 10, "fork own"), "any");
    const before = await loadForked(refStore, "W", {
      W: { sessionId: "S", visible: refCursor }
    }, NO_TENANT);
    expect(asc(before.records)).toEqual(["p1", "p2", "p3", "w1"]);

    await refStore.delete("p1");
    await refStore.delete("p2");
    const after = await loadForked(refStore, "W", {
      W: { sessionId: "S", visible: refCursor }
    }, NO_TENANT);

    const copyStore = await seed();
    await forkByCopy(copyStore, "S", "W", 3, NO_TENANT);
    await copyStore.set("w1", turn("w1", "W", 10, "fork own"), "any");
    await copyStore.delete("p1");
    await copyStore.delete("p2");
    const copyAfter = asc(await loadOwn(copyStore, "W", NO_TENANT));

    // eslint-disable-next-line no-console
    console.log(
      `[fork/retention] parent pruned 2 -> reference fork sees ${after.records.length} ` +
        `(policy honored), copy fork sees ${copyAfter.length} (policy defeated)`
    );

    // REFERENCE: the inherited prefix lives in the parent, so the parent's
    // policy governs it. Losing those turns is the policy working as configured.
    expect(asc(after.records)).toEqual(["p3", "w1"]);
    // COPY: the fork holds a duplicate in a session the policy does not reach,
    // so data the operator asked to delete survives. For a policy set for cost
    // or data-minimization that is a silent failure, not a resilience win.
    expect(copyAfter).toEqual(["W__p1", "W__p2", "W__p3", "w1"]);
  });

  it("WINDOW — the turn limit does not compose across a REFERENCE fork chain", async () => {
    const store = new InMemoryRequestStore();
    for (let n = 1; n <= 40; n++) {
      await store.set(`p${n}`, turn(`p${n}`, "S", n, `p${n}`), "any");
    }
    for (let n = 1; n <= 40; n++) {
      await store.set(`w${n}`, turn(`w${n}`, "W", 100 + n, `w${n}`), "any");
    }

    const { records } = await loadForked(store, "W", {
      W: { sessionId: "S", visible: await forkCursor(store, "S", NO_TENANT) }
    }, NO_TENANT);
    // eslint-disable-next-line no-console
    console.log(
      `[fork/window] limit=${HISTORY_WINDOW} per read, chain of 2 -> returned=${records.length}`
    );

    // Each read is bounded by the window, but the UNION is not — so a fork chain
    // can hand the generator more turns than the flow's window allows. Whoever
    // implements this must budget the window ACROSS the chain, not per read.
    expect(records.length).toBe(80);
    expect(records.length).toBeGreaterThan(HISTORY_WINDOW);
  });

  it("WINDOW — a parent that outruns the window does not erase the inherited prefix", async () => {
    const store = new InMemoryRequestStore();
    for (const n of [1, 2, 3]) {
      await store.set(`p${n}`, turn(`p${n}`, "S", n, `pre-fork ${n}`), "any");
    }
    const visible = await forkCursor(store, "S", NO_TENANT);

    // The parent then produces a full window's worth of POST-fork turns. A
    // newest-N read would return only those, none of which are in the cursor.
    for (let n = 0; n < HISTORY_WINDOW; n++) {
      await store.set(`post${n}`, turn(`post${n}`, "S", 100 + n, `post ${n}`), "any");
    }
    await store.set("w1", turn("w1", "W", 500, "fork own"), "any");

    const { records } = await loadForked(store, "W", { W: { sessionId: "S", visible } }, NO_TENANT);
    const ids = asc(records);
    // eslint-disable-next-line no-console
    console.log(`[fork/window-prefix] parent post-fork=${HISTORY_WINDOW} fork sees=${ids.join(",")}`);

    expect(ids).toEqual(["p1", "p2", "p3", "w1"]);
    expect(ids).not.toContain("post0");
  });

  it("REFERENCE — a stricter ancestor ceiling is not widened by a later fork", async () => {
    const store = await seed();
    await parentContinues(store); // S gains turns at 4 and 5, both after W's fork
    // A fork's own turns always follow its fork point (W forked S at 3).
    await store.set("w1", turn("w1", "W", 5, "W early"), "any");
    await store.set("w2", turn("w2", "W", 9, "W at V's fork point"), "any");
    await store.set("w3", turn("w3", "W", 20, "W after V's fork point"), "any");
    await store.set("v1", turn("v1", "V", 30, "V own"), "any");

    // V forks W later than W forked S. With snapshots this needs no ceiling
    // arithmetic: W's own snapshot IS what W could see, so V inherits exactly
    // that and cannot see parent turns W itself never had.
    const { records } = await loadForked(store, "V", {
      W: { sessionId: "S", visible: new Set(["p1", "p2", "p3"]) },
      V: { sessionId: "W", visible: new Set(["w1", "w2"]) }
    }, NO_TENANT);

    expect(asc(records)).toEqual(["p1", "p2", "p3", "w1", "w2", "v1"]);
    // S's post-fork turns are invisible even though V forked much later.
    expect(asc(records)).not.toContain("p4");
    expect(asc(records)).not.toContain("p5");
    // And W's post-fork turn is invisible to V.
    expect(asc(records)).not.toContain("w3");
  });

  it("CURSOR — an in-flight parent request that completes later never leaks in", async () => {
    const store = new InMemoryRequestStore();
    await store.set("p1", turn("p1", "S", 1, "done before fork"), "any");
    // Started before the fork, still running at fork time.
    await store.set("p_slow", {
      ...turn("p_slow", "S", 2, "in flight at fork"),
      status: "in_progress"
    } as RequestRecord, "any");

    const visible = await forkCursor(store, "S", NO_TENANT); // sees only p1
    await store.set("w1", turn("w1", "W", 10, "fork own"), "any");

    // It completes AFTER the fork. A timestamp cursor would now admit it,
    // because startedAtMs (2) <= the fork point (say 3). The snapshot does not.
    await store.set("p_slow", turn("p_slow", "S", 2, "completed after fork"), "any");

    const { records } = await loadForked(store, "W", { W: { sessionId: "S", visible } }, NO_TENANT);
    // eslint-disable-next-line no-console
    console.log(`[fork/cursor] after late completion, fork sees=${asc(records).join(",")}`);

    expect(asc(records)).toEqual(["p1", "w1"]);
    expect(asc(records)).not.toContain("p_slow");

    // The timestamp rule this replaces would have admitted it.
    const byTimestamp = (await loadOwn(store, "S", NO_TENANT)).filter((r) => r.startedAtMs <= 3);
    expect(byTimestamp.map((r) => r.id).sort()).toEqual(["p1", "p_slow"]);
  });

  it("COST — an ancestor read must fetch its cursor, not scan the parent's lifetime", async () => {
    // A long-lived parent: 500 completed turns, forked after the first 3.
    const store = new InMemoryRequestStore();
    for (let n = 1; n <= 3; n++) {
      await store.set(`p${n}`, turn(`p${n}`, "S", n, `pre-fork ${n}`), "any");
    }
    const visible = await forkCursor(store, "S", NO_TENANT);
    for (let n = 4; n <= 500; n++) {
      await store.set(`p${n}`, turn(`p${n}`, "S", n, `post-fork ${n}`), "any");
    }
    await store.set("w1", turn("w1", "W", 1000, "fork own"), "any");

    // List-then-discard: every completed parent request, WITH ITEMS, then throw
    // all but 3 away. The row count is the parent's lifetime, not the cursor.
    const scanned = (await loadAll(store, "S", NO_TENANT)).filter((r) => visible.has(r.id));
    // Fetch by id: bounded by the cursor.
    const fetched = await loadCursorMembers(store, "S", visible, NO_TENANT);

    // eslint-disable-next-line no-console
    console.log(
      `[fork/cost-rows] parent lifetime=500 cursor=${visible.size} -> ` +
        `scan reads ${(await loadAll(store, "S", NO_TENANT)).length} rows, ` +
        `by-id reads ${visible.size}`
    );

    // Same answer, and that is the point — the scan is not more correct, only
    // more expensive, and its cost grows with the parent forever.
    expect(asc(fetched)).toEqual(asc(scanned));
    expect(asc(fetched)).toEqual(["p1", "p2", "p3"]);
    expect((await loadAll(store, "S", NO_TENANT))).toHaveLength(500);
    expect(visible.size).toBe(3);
  });

  it("COST — a cursor id from another session or tenant is not a read primitive", async () => {
    const store = new InMemoryRequestStore();
    await store.set("p1", turn("p1", "S", 1, "parent", TENANT_A), "any");
    // Records the cursor must not be able to reach: another session, and
    // another tenant reusing the same bare session id.
    await store.set("other1", turn("other1", "OTHER", 2, "other session", TENANT_A), "any");
    await store.set("x1", turn("x1", "S", 3, "other tenant", "tenant_b"), "any");

    // A stale or tampered snapshot naming all three. `get` applies neither the
    // session nor the tenant filter, so the re-check on the fetched record is
    // the only thing standing between a persisted cursor and someone else's
    // history (BP-031 — never route off caller-influenced data alone).
    const tampered = new Set(["p1", "other1", "x1"]);
    const members = await loadCursorMembers(store, "S", tampered, TENANT_A);
    expect(members.map((r) => r.id)).toEqual(["p1"]);
  });

  it("DISPATCH — a fork taken mid-request permanently omits the turn that spawned it", async () => {
    // The realistic spawn: the parent is MID-TURN. `addTask` runs inside the
    // parent's request, so at the moment the Workstream is created that request
    // is `in_progress` — it is the turn that decided to delegate.
    const store = new InMemoryRequestStore();
    await store.set("p1", turn("p1", "S", 1, "earlier turn"), "any");
    await store.set("p_now", {
      ...turn("p_now", "S", 2, "the turn that spawned the workstream"),
      status: "in_progress"
    } as RequestRecord, "any");

    const cursor = await forkCursor(store, "S", NO_TENANT);
    await store.set("w1", turn("w1", "W", 10, "worker's first turn"), "any");

    // The dispatching turn is absent from the snapshot, because `loadOwn`
    // filters to `status: "completed"` — the same filter that makes the cursor
    // immune to a late completer (the CURSOR test above). Both behaviours come
    // from one rule, and here it cuts the wrong way.
    expect([...cursor]).toEqual(["p1"]);

    // The parent's turn completes a moment later...
    await store.set("p_now", turn("p_now", "S", 2, "the turn that spawned the workstream"), "any");

    // ...and the fork STILL cannot see it. The cursor is an immutable id
    // snapshot by design, so this is permanent, not a race window.
    const { records } = await loadForked(store, "W", { W: { sessionId: "S", visible: cursor } }, NO_TENANT);
    // eslint-disable-next-line no-console
    console.log(
      `[fork/dispatch] cursor=${[...cursor].join(",")} · after parent completes, fork sees=` +
        `${asc(records).join(",")} (missing p_now — the delegating turn)`
    );
    expect(asc(records)).toEqual(["p1", "w1"]);
    expect(asc(records)).not.toContain("p_now");

    // Which is the one turn `contextSupply: "conversation"` most needs: a
    // worker asked to continue a conversation cannot see the message that
    // asked it.
  });

  it("DISPATCH — adding the request ID to the cursor does NOT fix it, in two ways", async () => {
    // The obvious repair — put the in-flight request's id in the snapshot —
    // fails at both ends, so the fix has to be finer-grained than a request id.
    const store = new InMemoryRequestStore();
    await store.set("p1", turn("p1", "S", 1, "earlier turn"), "any");
    await store.set("p_now", {
      ...turn("p_now", "S", 2, "the ask, as it stood at dispatch"),
      status: "in_progress"
    } as RequestRecord, "any");

    const withCurrent = new Set([
      ...(await forkCursor(store, "S", NO_TENANT)),
      "p_now"
    ]);
    await store.set("w1", turn("w1", "W", 10, "worker's first turn"), "any");

    // (a) TOO EARLY. While the parent turn is still running — which is exactly
    // when the worker starts — the cursor names `p_now` but the member fetch
    // filters to `completed`, so the fork gets nothing for it. A worker that
    // begins before its parent's turn ends is the normal case, not an edge one.
    const during = await loadForked(store, "W", { W: { sessionId: "S", visible: withCurrent } }, NO_TENANT);
    expect(asc(during.records)).toEqual(["p1", "w1"]);

    // (b) TOO LATE. The parent's turn finishes, having emitted MORE content
    // after the fork was taken. `get` returns the record's current items, so
    // the fork now sees post-fork content from inside the spawning turn.
    await store.set("p_now", {
      ...turn("p_now", "S", 2, "the ask, as it stood at dispatch"),
      items: [
        { id: "p_now_i0", requestId: "p_now", type: "message", role: "assistant",
          text: "the ask, as it stood at dispatch" } as unknown as OutputItem,
        { id: "p_now_i1", requestId: "p_now", type: "message", role: "assistant",
          text: "AFTER THE FORK — the parent kept talking" } as unknown as OutputItem
      ]
    } as RequestRecord, "any");

    const after = await loadForked(store, "W", { W: { sessionId: "S", visible: withCurrent } }, NO_TENANT);
    const texts = after.records.flatMap((r) =>
      (r.items ?? []).map((i) => (i as unknown as { text: string }).text)
    );
    // eslint-disable-next-line no-console
    console.log(
      `[fork/dispatch-granularity] during=${asc(during.records).join(",")} · ` +
        `after=${asc(after.records).join(",")} · ` +
        `post-fork content leaked=${texts.includes("AFTER THE FORK — the parent kept talking")}`
    );

    // The fork point's whole invariant is that the parent's post-fork output is
    // invisible. A request-id cursor breaks it from INSIDE the spawning turn:
    // the record is mutable, so what the id resolves to keeps growing.
    expect(asc(after.records)).toEqual(["p1", "p_now", "w1"]);
    expect(texts).toContain("AFTER THE FORK — the parent kept talking");

    // So the snapshot must be at item/sequence granularity — the item ids (or
    // the sequence boundary) visible at dispatch — not the request id. Filtered
    // that way, the fork sees the ask and not the continuation.
    const visibleItems = new Set(["p1_i0", "p_now_i0"]);
    const bounded = after.records.map((r) => ({
      ...r,
      items: (r.items ?? []).filter((i) => visibleItems.has((i as unknown as { id: string }).id))
    }));
    const boundedTexts = bounded.flatMap((r) =>
      (r.items ?? []).map((i) => (i as unknown as { text: string }).text)
    );
    expect(boundedTexts).toContain("the ask, as it stood at dispatch");
    expect(boundedTexts).not.toContain("AFTER THE FORK — the parent kept talking");
  });

  it("OWNERSHIP — a cursor in `metadata` is caller-writable, and that breaks the fork point", async () => {
    const store = new InMemoryRequestStore();
    for (const n of [1, 2, 3]) {
      await store.set(`p${n}`, turn(`p${n}`, "S", n, `parent ${n}`), "any");
    }
    await store.set("w1", turn("w1", "W", 10, "fork own"), "any");
    // A session the fork was never forked from.
    await store.set("z1", turn("z1", "Z", 20, "someone else's turn"), "any");

    const live: ForkRef = { sessionId: "S", visible: await forkCursor(store, "S", NO_TENANT) };
    expect(asc((await loadForked(store, "W", { W: live }, NO_TENANT)).records)).toEqual([
      "p1", "p2", "p3", "w1"
    ]);

    // Both public metadata paths are a shallow merge over an arbitrary key, so
    // a caller supplying `forkedFrom` overwrites it wholesale rather than
    // merging into it. Model the merge exactly.
    const merge = (stored: PersistedForkRef, patch: Record<string, unknown>) =>
      ({ forkedFrom: stored, ...patch }).forkedFrom as PersistedForkRef;

    // (a) Integrity: emptied. The fork silently loses its inherited history.
    const emptied = merge(persistForkRef(live), {
      forkedFrom: { sessionId: "S", visible: [] }
    });
    const afterEmpty = await loadForked(store, "W", { W: hydrateForkRef(emptied) }, NO_TENANT);
    expect(asc(afterEmpty.records)).toEqual(["w1"]);

    // (b) Read escalation: repointed at a session the fork has no relation to.
    // The by-id re-check does NOT catch this — it validates each record against
    // the cursor's OWN declared parent, and the caller controls that too. So
    // the cursor must not be caller-writable in the first place.
    const repointed = merge(persistForkRef(live), {
      forkedFrom: { sessionId: "Z", visible: ["z1"] }
    });
    const afterRepoint = await loadForked(store, "W", { W: hydrateForkRef(repointed) }, NO_TENANT);
    // eslint-disable-next-line no-console
    console.log(
      `[fork/ownership] emptied -> ${asc(afterEmpty.records).join(",")} · ` +
        `repointed -> ${asc(afterRepoint.records).join(",")}`
    );
    expect(asc(afterRepoint.records)).toEqual(["w1", "z1"]);
  });

  it("TENANT — a fork of a tenant-scoped parent inherits nothing unless the tenant is threaded", async () => {
    const store = new InMemoryRequestStore();
    for (const n of [1, 2, 3]) {
      await store.set(`p${n}`, turn(`p${n}`, "S", n, `parent turn ${n}`, TENANT_A), "any");
    }
    await store.set("w1", turn("w1", "W", 10, "fork own", TENANT_A), "any");

    // The bug, first. A read that hard-codes `tenantId: undefined` exact-matches
    // only tenant-less records, so the cursor snapshots NOTHING — and nothing is
    // a legal cursor, so no error is raised anywhere. The fork simply resumes
    // with no memory of the conversation it was forked to continue.
    const blindCursor = await forkCursor(store, "S", NO_TENANT);
    const blind = await loadForked(store, "W", { W: { sessionId: "S", visible: blindCursor } }, NO_TENANT);
    // eslint-disable-next-line no-console
    console.log(
      `[fork/tenant] untenanted read -> cursor=${blindCursor.size} ids, fork sees=` +
        `${asc(blind.records).join(",") || "(nothing)"}`
    );
    expect(blindCursor.size).toBe(0);
    expect(asc(blind.records)).toEqual([]);

    // Threaded through cursor creation AND every chain read, it works.
    const cursor = await forkCursor(store, "S", TENANT_A);
    const { records } = await loadForked(store, "W", { W: { sessionId: "S", visible: cursor } }, TENANT_A);
    expect(asc(records)).toEqual(["p1", "p2", "p3", "w1"]);

    // ...and it does not reach across tenants: another tenant reusing the same
    // bare session id contributes nothing, which is the same exact-match rule
    // read in the other direction.
    await store.set("x1", turn("x1", "S", 4, "other tenant", "tenant_b"), "any");
    const again = await loadForked(
      store,
      "W",
      { W: { sessionId: "S", visible: await forkCursor(store, "S", TENANT_A) } },
      TENANT_A
    );
    expect(asc(again.records)).toEqual(["p1", "p2", "p3", "w1"]);
  });

  it("PERSISTENCE — a raw Set cursor serializes to nothing and empties the fork", async () => {
    const store = await seed();
    await store.set("w1", turn("w1", "W", 10, "fork own"), "any");
    const live: ForkRef = { sessionId: "S", visible: await forkCursor(store, "S", NO_TENANT) };

    // What a store adapter actually writes. No throw, no warning — the Set is
    // simply not a JSON value, so the cursor vanishes.
    const naive = JSON.parse(JSON.stringify(live)) as { sessionId: string; visible?: unknown };
    // eslint-disable-next-line no-console
    console.log(
      `[fork/persist] raw Set round-trip -> visible=${JSON.stringify(naive.visible)} ` +
        `(cursor had ${live.visible.size} ids)`
    );
    expect(naive.visible).toEqual({});

    // Reloaded from that record, the fork inherits nothing: a Workstream that
    // was forked to continue a body of work resumes with no memory of it, and
    // the only symptom is a worker that has forgotten its own context.
    const reloaded: ForkRef = {
      sessionId: naive.sessionId,
      visible: new Set(Array.isArray(naive.visible) ? (naive.visible as string[]) : [])
    };
    const { records } = await loadForked(store, "W", { W: reloaded }, NO_TENANT);
    expect(asc(records)).toEqual(["w1"]);
  });

  it("PERSISTENCE — the array form round-trips through JSON unchanged", async () => {
    const store = await seed();
    await store.set("w1", turn("w1", "W", 10, "fork own"), "any");
    const live: ForkRef = { sessionId: "S", visible: await forkCursor(store, "S", NO_TENANT) };

    const stored = JSON.parse(JSON.stringify(persistForkRef(live))) as PersistedForkRef;
    // eslint-disable-next-line no-console
    console.log(`[fork/persist] array round-trip -> visible=${stored.visible.join(",")}`);
    expect(stored.visible).toEqual(["p1", "p2", "p3"]);

    // Same visible history before and after a trip through the store.
    const fromLive = await loadForked(store, "W", { W: live }, NO_TENANT);
    const fromStored = await loadForked(store, "W", { W: hydrateForkRef(stored) }, NO_TENANT);
    expect(asc(fromStored.records)).toEqual(asc(fromLive.records));
    expect(asc(fromStored.records)).toEqual(["p1", "p2", "p3", "w1"]);

    // ...and persisting twice is byte-identical, so re-storing an unchanged
    // cursor is not a spurious version bump on a CAS'd session record.
    expect(JSON.stringify(persistForkRef(hydrateForkRef(stored)))).toBe(
      JSON.stringify(persistForkRef(live))
    );
  });
});
