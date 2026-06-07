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
