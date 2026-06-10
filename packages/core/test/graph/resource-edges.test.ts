import { describe, expect, it } from "vitest";
import { createResourceEdgeApi, type EdgeBackingRef, type EdgeSlotConfig } from "../../src/graph";
import type { Edge } from "../../src/graph";

/** A tiny in-memory ref whose `updateState` mutates a held state object. */
function makeFakeRef(initial: Record<string, unknown> = {}): EdgeBackingRef & {
  current: Record<string, unknown>;
} {
  const holder = { current: { edges: [] as Edge[], ...initial } };
  return {
    current: holder.current,
    get state() {
      return holder.current as { edges?: Edge[] } & Record<string, unknown>;
    },
    async updateState(updater) {
      holder.current = await updater(holder.current);
      // keep `current` pointing at the latest state for assertions
      (this as { current: Record<string, unknown> }).current = holder.current;
    },
  };
}

function api(ref: EdgeBackingRef, slot: EdgeSlotConfig = {}) {
  return createResourceEdgeApi(ref, slot);
}

describe("createResourceEdgeApi", () => {
  it("throws when constructed over a ref whose state has no edges array", () => {
    // Guards the silent-write-loss footgun: edges declared but the state
    // schema lacks the field, so Zod would strip writes on persist.
    const badRef = {
      get state() {
        return {} as { edges?: Edge[] } & Record<string, unknown>;
      },
      async updateState() {
        /* no-op */
      },
    } as EdgeBackingRef;
    expect(() => createResourceEdgeApi(badRef, {})).toThrow(/no `edges` array/);
  });

  it("add assigns a crypto-strong id, defaults, createdAt and persists", async () => {
    const ref = makeFakeRef();
    const edge = await api(ref).add({ from: "a", to: "b", type: "drives" });

    expect(edge.id).toMatch(/[0-9a-f-]{36}/);
    expect(edge.confidence).toBe(1);
    expect(edge.validFrom).toBeNull();
    expect(edge.validUntil).toBeNull();
    expect(edge.source).toEqual([]);
    expect(typeof edge.createdAt).toBe("string");
    expect((ref.state.edges ?? [])).toHaveLength(1);
    expect(ref.state.edges?.[0]).toEqual(edge);
  });

  it("add honours explicit confidence/validFrom/source", async () => {
    const ref = makeFakeRef();
    const edge = await api(ref).add({
      from: "a",
      to: "b",
      type: "drives",
      confidence: 0.5,
      validFrom: "2026-01-01T00:00:00.000Z",
      source: ["ep1"],
    });
    expect(edge.confidence).toBe(0.5);
    expect(edge.validFrom).toBe("2026-01-01T00:00:00.000Z");
    expect(edge.source).toEqual(["ep1"]);
  });

  it("add enforces vocabulary", async () => {
    const ref = makeFakeRef();
    const e = api(ref, { vocabulary: ["drives"] });
    await expect(e.add({ from: "a", to: "b", type: "owns" })).rejects.toThrow(/vocabulary/);
    expect(ref.state.edges ?? []).toHaveLength(0);
    await expect(e.add({ from: "a", to: "b", type: "drives" })).resolves.toBeDefined();
  });

  it("maxEdges culls the lowest-confidence edges on overflow", async () => {
    const ref = makeFakeRef();
    const e = api(ref, { maxEdges: 2 });
    await e.add({ from: "a", to: "b", type: "r", confidence: 0.2 });
    await e.add({ from: "a", to: "c", type: "r", confidence: 0.9 });
    await e.add({ from: "a", to: "d", type: "r", confidence: 0.5 });

    const stored = ref.state.edges ?? [];
    expect(stored).toHaveLength(2);
    const confidences = stored.map((x) => x.confidence).sort();
    expect(confidences).toEqual([0.5, 0.9]);
  });

  it("maxEdges drops superseded edges before active lower-confidence ones", async () => {
    // Seed two active edges, then a third add that overflows cap=2. One of the
    // existing edges is superseded (a tombstone) but has higher confidence than
    // the surviving active edge — it must still be the one dropped.
    const ref = makeFakeRef();
    const e = api(ref, { maxEdges: 2 });
    const tombstone = await e.add({ from: "a", to: "b", type: "r", confidence: 0.95 });
    await e.supersede(tombstone.id); // high-confidence but superseded
    await e.add({ from: "a", to: "c", type: "r", confidence: 0.3 }); // active, low confidence
    await e.add({ from: "a", to: "d", type: "r", confidence: 0.4 }); // overflow → cull

    const stored = ref.state.edges ?? [];
    expect(stored).toHaveLength(2);
    // The superseded high-confidence edge is gone; both survivors are active.
    expect(stored.find((x) => x.id === tombstone.id)).toBeUndefined();
    expect(stored.every((x) => x.validUntil === null)).toBe(true);
    expect(stored.map((x) => x.confidence).sort()).toEqual([0.3, 0.4]);
  });

  it("maxEdges never culls the just-added edge (add returns a stored edge)", async () => {
    // Saturate the cap with higher-confidence active edges, then add a lower
    // one. Without protection the cull would drop the new edge and `add` would
    // return a phantom id; the new edge must survive and an existing edge goes.
    const ref = makeFakeRef();
    const e = api(ref, { maxEdges: 2 });
    await e.add({ from: "a", to: "b", type: "r", confidence: 0.9 });
    await e.add({ from: "a", to: "c", type: "r", confidence: 0.8 });
    const added = await e.add({ from: "a", to: "d", type: "r", confidence: 0.3 }); // lowest, just added

    const stored = ref.state.edges ?? [];
    expect(stored).toHaveLength(2);
    // The returned edge is actually in storage — supersede/remove will resolve.
    expect(stored.find((x) => x.id === added.id)).toBeDefined();
    // The lowest-confidence EXISTING edge (0.8) was culled instead of the new one.
    expect(stored.map((x) => x.confidence).sort()).toEqual([0.3, 0.9]);
  });

  it("maxEdges confidence-tie cull is deterministic (oldest createdAt dropped first)", async () => {
    // Three active edges with identical confidence; cap=2 forces one out. The
    // oldest (first-created) must be the one culled, deterministically.
    const ref = makeFakeRef();
    const e = api(ref, { maxEdges: 2 });
    const oldest = await e.add({ from: "a", to: "b", type: "r", confidence: 0.5 });
    // Force strictly increasing createdAt so the tiebreak is observable even if
    // the clock has millisecond resolution.
    const bump = (edge: Edge, ms: number) => {
      const edges = (ref.state.edges as Edge[]).map((x) =>
        x.id === edge.id ? { ...x, createdAt: new Date(ms).toISOString() } : x,
      );
      (ref.current as Record<string, unknown>).edges = edges;
    };
    bump(oldest, 1000);
    const middle = await e.add({ from: "a", to: "c", type: "r", confidence: 0.5 });
    bump(middle, 2000);
    await e.add({ from: "a", to: "d", type: "r", confidence: 0.5 });

    const stored = ref.state.edges ?? [];
    expect(stored).toHaveLength(2);
    expect(stored.find((x) => x.id === oldest.id)).toBeUndefined();
  });

  it("supersede sets validUntil without removing the edge", async () => {
    const ref = makeFakeRef();
    const edge = await api(ref).add({ from: "a", to: "b", type: "r" });
    await api(ref).supersede(edge.id, "2026-06-01T00:00:00.000Z");

    const stored = ref.state.edges ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0].validUntil).toBe("2026-06-01T00:00:00.000Z");
  });

  it("supersede defaults validUntil to now and is a no-op for absent ids", async () => {
    const ref = makeFakeRef();
    const edge = await api(ref).add({ from: "a", to: "b", type: "r" });
    await api(ref).supersede("does-not-exist");
    expect(ref.state.edges?.[0].validUntil).toBeNull();

    await api(ref).supersede(edge.id);
    expect(ref.state.edges?.[0].validUntil).not.toBeNull();
  });

  it("remove deletes an edge by id", async () => {
    const ref = makeFakeRef();
    const a = await api(ref).add({ from: "a", to: "b", type: "r" });
    await api(ref).add({ from: "a", to: "c", type: "r" });
    await api(ref).remove(a.id);

    const stored = ref.state.edges ?? [];
    expect(stored).toHaveLength(1);
    expect(stored.find((x) => x.id === a.id)).toBeUndefined();
  });

  it("all returns every edge; all({at}) filters to active edges", async () => {
    const ref = makeFakeRef();
    const live = await api(ref).add({ from: "a", to: "b", type: "r" });
    const old = await api(ref).add({ from: "c", to: "d", type: "r" });
    await api(ref).supersede(old.id, "2026-01-01T00:00:00.000Z");

    expect(api(ref).all()).toHaveLength(2);
    const active = api(ref).all({ at: "2026-06-01T00:00:00.000Z" });
    expect(active.map((e) => e.id)).toEqual([live.id]);
  });

  it("neighbors / egoGraph / shortestPath delegate to the traversal helpers", async () => {
    const ref = makeFakeRef();
    await api(ref).add({ from: "a", to: "b", type: "r" });
    await api(ref).add({ from: "b", to: "c", type: "r" });

    expect(api(ref).neighbors("a")).toHaveLength(1);

    const ego = api(ref).egoGraph("a", { depth: 2 });
    expect(ego.nodes.sort()).toEqual(["a", "b", "c"]);
    expect(ego.edges).toHaveLength(2);

    const path = api(ref).shortestPath("a", "c", { depth: 3 });
    expect(path).not.toBeNull();
    expect(path).toHaveLength(2);

    expect(api(ref).shortestPath("a", "zzz")).toBeNull();
  });

  it("pruneDangling drops edges with unknown endpoints and returns the count", async () => {
    const ref = makeFakeRef();
    await api(ref).add({ from: "a", to: "b", type: "r" });
    await api(ref).add({ from: "a", to: "ghost", type: "r" });

    const removed = await api(ref).pruneDangling(["a", "b"]);
    expect(removed).toBe(1);
    expect(ref.state.edges).toHaveLength(1);
    expect(ref.state.edges?.[0].to).toBe("b");
  });
});
