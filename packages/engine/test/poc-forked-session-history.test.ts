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

const HISTORY_WINDOW = 50;

function turn(id: string, sessionId: string, startedAtMs: number, text: string): RequestRecord {
  return {
    id,
    flowKind: "chat",
    actionName: "send",
    userId: "u1",
    sessionId,
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

/** Verbatim shape of the cross-turn history load (createExecutionContext.ts:526-536). */
function loadOwn(store: InMemoryRequestStore, sessionId: string) {
  return store.list({
    sessionId,
    tenantId: undefined,
    status: "completed",
    limit: HISTORY_WINDOW,
    orderBy: "startedAtMs",
    withItems: true
  });
}

/** Unbounded read — an ancestor's contribution is bounded by its snapshot, not by N. */
function loadAll(store: InMemoryRequestStore, sessionId: string) {
  return store.list({
    sessionId,
    tenantId: undefined,
    status: "completed",
    orderBy: "startedAtMs",
    withItems: true
  });
}

const asc = (rs: RequestRecord[]) =>
  [...rs].sort((a, b) => a.startedAtMs - b.startedAtMs).map((r) => r.id);

// ─── Strategy 1: COPY ────────────────────────────────────────────────────────

/**
 * Duplicates the parent's history into the fork. Note the id rewrite: request
 * ids are primary keys, so copies cannot reuse them — which means the copies
 * are no longer the same records, and provenance to the original turn is lost
 * unless a back-reference is added.
 */
async function forkByCopy(
  store: InMemoryRequestStore,
  parentSessionId: string,
  forkSessionId: string,
  atMs: number
): Promise<{ writes: number }> {
  const parent = await loadOwn(store, parentSessionId);
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
 * What actually gets stored. A fork ref lives on the Workstream's session record
 * (`SessionRecord.metadata`), which is persisted as JSON by every adapter, and
 * `JSON.stringify(new Set([...]))` is `{}` — the cursor would serialize to
 * nothing at all, silently, with no error at write time. The fork would come
 * back from the store with an empty snapshot and inherit no history.
 *
 * So the persisted shape is an array and the runtime shape is a Set; the
 * conversion is explicit at both ends rather than implied. Measured below.
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
  parentSessionId: string
): Promise<ReadonlySet<string>> {
  const completed = await loadOwn(store, parentSessionId);
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
  forks: Record<string, ForkRef>
): Promise<{ records: RequestRecord[]; reads: number }> {
  const out: RequestRecord[] = [];
  let reads = 0;
  let cursor: string | undefined = sessionId;
  let visible: ReadonlySet<string> | undefined; // undefined = the fork's own session

  while (cursor !== undefined) {
    // The cursor members must be selected BEFORE the window limit, not after.
    // `loadOwn` takes the newest N; if the parent has produced N post-fork turns
    // then none of the cursor's pre-fork ids survive that cut, and the fork
    // silently loses its entire inherited prefix while retention removed
    // nothing. Fetch unbounded for an ancestor and filter to the snapshot.
    const own =
      visible === undefined
        ? await loadOwn(store, cursor)
        : (await loadAll(store, cursor)).filter((r) => visible!.has(r.id));
    reads++;
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
    const { writes } = await forkByCopy(store, "S", "W", 3);
    await parentContinues(store);
    await store.set("w1", turn("w1", "W", 10, "fork's own turn"), "any");

    const fork = asc(await loadOwn(store, "W"));
    // eslint-disable-next-line no-console
    console.log(`[fork/copy] writes-at-fork=${writes} reads-at-load=1 window=${fork.length}`);

    expect(fork).toEqual(["W__p1", "W__p2", "W__p3", "w1"]);
    // Parent turns 4 and 5 happened AFTER the fork — invisible.
    expect(fork.some((id) => id.endsWith("p4") || id.endsWith("p5"))).toBe(false);
    // And the parent never sees the fork.
    expect(asc(await loadOwn(store, "S"))).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("REFERENCE — same visible history, no writes at fork", async () => {
    const store = await seed();
    const forks: Record<string, ForkRef> = {
      W: { sessionId: "S", visible: await forkCursor(store, "S") }
    };
    await parentContinues(store);
    await store.set("w1", turn("w1", "W", 10, "fork's own turn"), "any");

    const { records, reads } = await loadForked(store, "W", forks);
    // eslint-disable-next-line no-console
    console.log(`[fork/ref] writes-at-fork=0 reads-at-load=${reads} window=${records.length}`);

    expect(asc(records)).toEqual(["p1", "p2", "p3", "w1"]);
    expect(asc(await loadOwn(store, "S"))).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("both strategies agree on what the fork can see", async () => {
    const copyStore = await seed();
    await forkByCopy(copyStore, "S", "W", 3);
    await parentContinues(copyStore);
    await copyStore.set("w1", turn("w1", "W", 10, "own"), "any");

    const refStore = await seed();
    const cur = await forkCursor(refStore, "S");
    await parentContinues(refStore);
    await refStore.set("w1", turn("w1", "W", 10, "own"), "any");
    const { records } = await loadForked(refStore, "W", { W: { sessionId: "S", visible: cur } });

    const textsOf = (rs: RequestRecord[]) =>
      [...rs]
        .sort((a, b) => a.startedAtMs - b.startedAtMs)
        .flatMap((r) => (r.items ?? []).map((i) => (i as unknown as { text: string }).text));

    expect(textsOf(await loadOwn(copyStore, "W"))).toEqual(textsOf(records));
  });

  it("COPY cost scales with parent history; REFERENCE cost is constant", async () => {
    const store = new InMemoryRequestStore();
    for (let n = 1; n <= 40; n++) {
      await store.set(`p${n}`, turn(`p${n}`, "S", n, `t${n}`), "any");
    }
    const { writes } = await forkByCopy(store, "S", "W", 40);
    const { reads } = await loadForked(store, "W2", {
      W2: { sessionId: "S", visible: await forkCursor(store, "S") }
    });

    // eslint-disable-next-line no-console
    console.log(`[fork/cost] 40-turn parent -> copy writes=${writes}, reference writes=0 reads=${reads}`);
    expect(writes).toBe(40);
    expect(reads).toBe(2);
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
    const { records, reads } = await loadForked(store, "V", forks);

    // eslint-disable-next-line no-console
    console.log(`[fork/chain] depth=2 reads=${reads} visible=${asc(records).join(",")}`);

    // V sees S's prefix, W up to 12, its own — and NOT W's later turn.
    expect(asc(records)).toEqual(["p1", "p2", "p3", "w1", "w2", "v1"]);
    expect(reads).toBe(3);
  });

  it("RETENTION — COPY defeats the parent's policy; REFERENCE honors it", async () => {
    // Retention is OPT-IN: `resolveRetentionPolicy` returns undefined unless a
    // flow sets `maxItems` or `maxAge`, and it prunes a session's own completed
    // requests lazily after a request finishes. So this only happens when an
    // operator asked for it — which is what makes the direction matter.
    const refStore = await seed();
    const refCursor = await forkCursor(refStore, "S");
    await refStore.set("w1", turn("w1", "W", 10, "fork own"), "any");
    const before = await loadForked(refStore, "W", {
      W: { sessionId: "S", visible: refCursor }
    });
    expect(asc(before.records)).toEqual(["p1", "p2", "p3", "w1"]);

    await refStore.delete("p1");
    await refStore.delete("p2");
    const after = await loadForked(refStore, "W", {
      W: { sessionId: "S", visible: refCursor }
    });

    const copyStore = await seed();
    await forkByCopy(copyStore, "S", "W", 3);
    await copyStore.set("w1", turn("w1", "W", 10, "fork own"), "any");
    await copyStore.delete("p1");
    await copyStore.delete("p2");
    const copyAfter = asc(await loadOwn(copyStore, "W"));

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
      W: { sessionId: "S", visible: await forkCursor(store, "S") }
    });
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
    const visible = await forkCursor(store, "S");

    // The parent then produces a full window's worth of POST-fork turns. A
    // newest-N read would return only those, none of which are in the cursor.
    for (let n = 0; n < HISTORY_WINDOW; n++) {
      await store.set(`post${n}`, turn(`post${n}`, "S", 100 + n, `post ${n}`), "any");
    }
    await store.set("w1", turn("w1", "W", 500, "fork own"), "any");

    const { records } = await loadForked(store, "W", { W: { sessionId: "S", visible } });
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
    });

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

    const visible = await forkCursor(store, "S"); // sees only p1
    await store.set("w1", turn("w1", "W", 10, "fork own"), "any");

    // It completes AFTER the fork. A timestamp cursor would now admit it,
    // because startedAtMs (2) <= the fork point (say 3). The snapshot does not.
    await store.set("p_slow", turn("p_slow", "S", 2, "completed after fork"), "any");

    const { records } = await loadForked(store, "W", { W: { sessionId: "S", visible } });
    // eslint-disable-next-line no-console
    console.log(`[fork/cursor] after late completion, fork sees=${asc(records).join(",")}`);

    expect(asc(records)).toEqual(["p1", "w1"]);
    expect(asc(records)).not.toContain("p_slow");

    // The timestamp rule this replaces would have admitted it.
    const byTimestamp = (await loadOwn(store, "S")).filter((r) => r.startedAtMs <= 3);
    expect(byTimestamp.map((r) => r.id).sort()).toEqual(["p1", "p_slow"]);
  });

  it("PERSISTENCE — a raw Set cursor serializes to nothing and empties the fork", async () => {
    const store = await seed();
    await store.set("w1", turn("w1", "W", 10, "fork own"), "any");
    const live: ForkRef = { sessionId: "S", visible: await forkCursor(store, "S") };

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
    const { records } = await loadForked(store, "W", { W: reloaded });
    expect(asc(records)).toEqual(["w1"]);
  });

  it("PERSISTENCE — the array form round-trips through JSON unchanged", async () => {
    const store = await seed();
    await store.set("w1", turn("w1", "W", 10, "fork own"), "any");
    const live: ForkRef = { sessionId: "S", visible: await forkCursor(store, "S") };

    const stored = JSON.parse(JSON.stringify(persistForkRef(live))) as PersistedForkRef;
    // eslint-disable-next-line no-console
    console.log(`[fork/persist] array round-trip -> visible=${stored.visible.join(",")}`);
    expect(stored.visible).toEqual(["p1", "p2", "p3"]);

    // Same visible history before and after a trip through the store.
    const fromLive = await loadForked(store, "W", { W: live });
    const fromStored = await loadForked(store, "W", { W: hydrateForkRef(stored) });
    expect(asc(fromStored.records)).toEqual(asc(fromLive.records));
    expect(asc(fromStored.records)).toEqual(["p1", "p2", "p3", "w1"]);

    // ...and persisting twice is byte-identical, so re-storing an unchanged
    // cursor is not a spurious version bump on a CAS'd session record.
    expect(JSON.stringify(persistForkRef(hydrateForkRef(stored)))).toBe(
      JSON.stringify(persistForkRef(live))
    );
  });
});
