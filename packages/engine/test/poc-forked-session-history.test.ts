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

type ForkRef = { sessionId: string; atMs: number };

/**
 * Unions the fork's own requests with the parent's up-to-fork-point prefix,
 * walking the chain so a fork-of-a-fork still resolves. This is the query
 * change the copy strategy avoids.
 */
async function loadForked(
  store: InMemoryRequestStore,
  sessionId: string,
  forks: Record<string, ForkRef>
): Promise<{ records: RequestRecord[]; reads: number }> {
  const out: RequestRecord[] = [];
  let reads = 0;
  let cursor: string | undefined = sessionId;
  let ceiling = Number.POSITIVE_INFINITY;

  while (cursor !== undefined) {
    const own = await loadOwn(store, cursor);
    reads++;
    out.push(...own.filter((r) => r.startedAtMs <= ceiling));
    const ref: ForkRef | undefined = forks[cursor];
    if (ref === undefined) break;
    ceiling = Math.min(ceiling, ref.atMs);
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
    const forks: Record<string, ForkRef> = { W: { sessionId: "S", atMs: 3 } };
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
    await parentContinues(refStore);
    await refStore.set("w1", turn("w1", "W", 10, "own"), "any");
    const { records } = await loadForked(refStore, "W", { W: { sessionId: "S", atMs: 3 } });

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
    const { reads } = await loadForked(store, "W2", { W2: { sessionId: "S", atMs: 40 } });

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
      W: { sessionId: "S", atMs: 3 },
      V: { sessionId: "W", atMs: 12 }
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
    await refStore.set("w1", turn("w1", "W", 10, "fork own"), "any");
    const before = await loadForked(refStore, "W", { W: { sessionId: "S", atMs: 3 } });
    expect(asc(before.records)).toEqual(["p1", "p2", "p3", "w1"]);

    await refStore.delete("p1");
    await refStore.delete("p2");
    const after = await loadForked(refStore, "W", { W: { sessionId: "S", atMs: 3 } });

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

    const { records } = await loadForked(store, "W", { W: { sessionId: "S", atMs: 40 } });
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

  it("REFERENCE — a stricter ancestor ceiling is not widened by a later fork", async () => {
    const store = await seed();
    await parentContinues(store); // S gains turns at 4 and 5, both after W's fork
    // A fork's own turns always follow its fork point (W forked S at 3).
    await store.set("w1", turn("w1", "W", 5, "W early"), "any");
    await store.set("w2", turn("w2", "W", 9, "W at V's fork point"), "any");
    await store.set("w3", turn("w3", "W", 20, "W after V's fork point"), "any");
    await store.set("v1", turn("v1", "V", 30, "V own"), "any");

    // V forks W at 9, but W itself only ever saw S up to 3. The walk must carry
    // the tighter ceiling down to S rather than re-widening it to 9 — otherwise
    // V would see parent turns W itself never had.
    const { records } = await loadForked(store, "V", {
      W: { sessionId: "S", atMs: 3 },
      V: { sessionId: "W", atMs: 9 }
    });

    expect(asc(records)).toEqual(["p1", "p2", "p3", "w1", "w2", "v1"]);
    // S's post-fork turns are invisible even though V's own ceiling (9) is
    // later than them — the ancestor's ceiling wins.
    expect(asc(records)).not.toContain("p4");
    expect(asc(records)).not.toContain("p5");
    // And W's post-fork turn is invisible to V.
    expect(asc(records)).not.toContain("w3");
  });
});
