/**
 * Unit tests for the FIX-739 reducer that merges `live: true` `resource_change`
 * items into the cached SessionStateSnapshotResponse — the resource-side analog
 * of mergeStateChangeIntoSnapshot. Single resources update `clientData`
 * directly; collection items land in a per-topic `live` overlay.
 */
import { describe, expect, it } from "vitest";
import type {
  SessionStateSnapshotResponse,
  CollectionSnapshotEntry,
  ResourceSnapshotEntry,
} from "@flow-state-dev/client";
import type { ResourceChangeItem, ItemProvenance } from "@flow-state-dev/core/items";
import {
  isReducibleResourceChange,
  mergeResourceChangeIntoSnapshot,
} from "../src/internal/mergeResourceChangeIntoSnapshot";

const provenance: ItemProvenance = {
  blockName: "runtime",
  blockInstanceId: "runtime",
  phase: "main",
};

let counter = 0;
function rc(
  partial: Partial<ResourceChangeItem> &
    Pick<ResourceChangeItem, "scope" | "resourcePath" | "changeType">
): ResourceChangeItem {
  counter += 1;
  return {
    id: `item_${counter}`,
    type: "resource_change",
    status: "completed",
    transient: true,
    requestId: "req",
    itemIndex: counter,
    provenance,
    ts: 0,
    ...partial,
  };
}

function snapshot(
  resources: SessionStateSnapshotResponse["resources"]
): SessionStateSnapshotResponse {
  return {
    sessionId: "sess",
    flowKind: "test",
    clientData: {},
    resources,
  };
}

describe("isReducibleResourceChange", () => {
  it("matches resource_change items carrying a delta in a reducible scope", () => {
    expect(
      isReducibleResourceChange(
        rc({ scope: "session", resourcePath: "memos/m1", changeType: "updated", delta: { status: "writing" } })
      )
    ).toBe(true);
  });

  it("rejects deltaless resource_change items (batched-refetch path)", () => {
    expect(
      isReducibleResourceChange(rc({ scope: "session", resourcePath: "memos/m1", changeType: "updated" }))
    ).toBe(false);
  });

  it("rejects request-scope changes and non-resource_change items", () => {
    expect(
      isReducibleResourceChange(
        rc({ scope: "request", resourcePath: "x", changeType: "updated", delta: { a: 1 } })
      )
    ).toBe(false);
  });
});

describe("mergeResourceChangeIntoSnapshot — single resource", () => {
  it("replaces clientData on an update", () => {
    const prev = snapshot({ session: { soul: { clientData: { tone: "calm" } } } });
    const next = mergeResourceChangeIntoSnapshot(
      prev,
      rc({ scope: "session", resourcePath: "soul", changeType: "updated", delta: { tone: "excited" } })
    );
    expect((next!.resources!.session!.soul as ResourceSnapshotEntry).clientData).toEqual({ tone: "excited" });
    expect(next).not.toBe(prev);
  });

  it("returns prev unchanged when the delta equals the stored value", () => {
    const data = { tone: "calm" };
    const prev = snapshot({ session: { soul: { clientData: data } } });
    const next = mergeResourceChangeIntoSnapshot(
      prev,
      rc({ scope: "session", resourcePath: "soul", changeType: "updated", delta: data })
    );
    expect(next).toBe(prev);
  });
});

describe("mergeResourceChangeIntoSnapshot — collection item", () => {
  function collSnapshot(entry: CollectionSnapshotEntry): SessionStateSnapshotResponse {
    return snapshot({ session: { memos: entry } });
  }
  const memo = (path: string, changeType: ResourceChangeItem["changeType"], delta: unknown) =>
    rc({ scope: "session", resourcePath: path, changeType, delta });

  it("folds an updated delta into the per-topic live overlay", () => {
    const prev = collSnapshot({ count: 1 });
    const next = mergeResourceChangeIntoSnapshot(prev, memo("memos/m1", "updated", { status: "writing" }));
    const entry = next!.resources!.session!.memos as CollectionSnapshotEntry;
    expect(entry.live).toEqual({ m1: { clientData: { status: "writing" } } });
    expect(entry.count).toBe(1); // count is untouched — it reconciles at refetch
  });

  it("captures a multi-segment topic", () => {
    const prev = collSnapshot({ count: 0 });
    const next = mergeResourceChangeIntoSnapshot(prev, memo("memos/p1/fundamentals", "created", { status: "pending" }));
    const entry = next!.resources!.session!.memos as CollectionSnapshotEntry;
    expect(entry.live).toEqual({ "p1/fundamentals": { clientData: { status: "pending" } } });
  });

  it("writes a tombstone (not a key removal) on delete, leaving count alone", () => {
    const prev = collSnapshot({ count: 2, live: { m1: { clientData: { status: "writing" } } } });
    const next = mergeResourceChangeIntoSnapshot(prev, rc({ scope: "session", resourcePath: "memos/m1", changeType: "deleted", delta: null }));
    const entry = next!.resources!.session!.memos as CollectionSnapshotEntry;
    // Tombstone overwrites the prior overlay so the hook can show the item as
    // gone without falling back to the stale baseline.
    expect(entry.live).toEqual({ m1: { deleted: true } });
    expect(entry.count).toBe(2);
  });

  it("tombstones a never-overlaid topic on delete", () => {
    const prev = collSnapshot({ count: 5 });
    const next = mergeResourceChangeIntoSnapshot(prev, rc({ scope: "session", resourcePath: "memos/old", changeType: "deleted", delta: null }));
    expect((next!.resources!.session!.memos as CollectionSnapshotEntry).live).toEqual({ old: { deleted: true } });
  });

  it("returns prev when the overlaid delta is unchanged", () => {
    const data = { status: "writing" };
    const prev = collSnapshot({ count: 1, live: { m1: { clientData: data } } });
    const next = mergeResourceChangeIntoSnapshot(prev, memo("memos/m1", "updated", data));
    expect(next).toBe(prev);
  });

  it("returns prev on a repeated delete tombstone", () => {
    const prev = collSnapshot({ count: 1, live: { m1: { deleted: true } } });
    const next = mergeResourceChangeIntoSnapshot(prev, rc({ scope: "session", resourcePath: "memos/m1", changeType: "deleted", delta: null }));
    expect(next).toBe(prev);
  });
});

describe("mergeResourceChangeIntoSnapshot — guards", () => {
  it("returns prev when no snapshot exists", () => {
    expect(mergeResourceChangeIntoSnapshot(null, rc({ scope: "session", resourcePath: "x", changeType: "updated", delta: {} }))).toBeNull();
  });

  it("returns prev when no entry anchors the path", () => {
    const prev = snapshot({ session: { other: { count: 0 } } });
    const next = mergeResourceChangeIntoSnapshot(prev, rc({ scope: "session", resourcePath: "memos/m1", changeType: "updated", delta: { a: 1 } }));
    expect(next).toBe(prev);
  });

  it("returns prev when the scope has no resources", () => {
    const prev = snapshot({ user: { doc: { clientData: {} } } });
    const next = mergeResourceChangeIntoSnapshot(prev, rc({ scope: "session", resourcePath: "doc", changeType: "updated", delta: { a: 1 } }));
    expect(next).toBe(prev);
  });
});
