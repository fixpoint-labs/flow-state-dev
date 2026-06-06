/**
 * Integration test for the FIX-739 live-overlay read path that
 * `useResourceCollectionItem` performs: a live `resource_change` is folded into
 * the snapshot by `mergeResourceChangeIntoSnapshot`, then the hook reads
 * `resources[scope][ref].live[topic].clientData` and layers it over the fetched
 * baseline. This exercises both halves (reduce + the snapshot read the hook's
 * `useMemo` performs) as pure values — the react package has no DOM/render
 * harness by convention, so the overlay wrapper is validated structurally: it
 * is a snapshot read, never an HTTP call.
 */
import { describe, expect, it } from "vitest";
import type { ResourceChangeItem, ItemProvenance } from "@flow-state-dev/core/items";
import type { CollectionSnapshotEntry, SessionStateSnapshotResponse } from "@flow-state-dev/client";
import { mergeResourceChangeIntoSnapshot } from "../src/internal/mergeResourceChangeIntoSnapshot";

const provenance: ItemProvenance = { blockName: "runtime", blockInstanceId: "runtime", phase: "main" };

function liveChange(resourcePath: string, delta: unknown): ResourceChangeItem {
  return {
    id: `item_${resourcePath}`,
    type: "resource_change",
    status: "completed",
    transient: true,
    requestId: "req",
    itemIndex: 0,
    provenance,
    ts: 0,
    scope: "session",
    resourcePath,
    changeType: "updated",
    delta,
  };
}

/**
 * The exact read `useResourceCollectionItem` does: locate the collection entry
 * and apply its per-topic live overlay over the fetched baseline. `baseline`
 * is `null` when the HTTP fetch hasn't resolved (or returned nothing).
 */
function readItem(
  snapshot: SessionStateSnapshotResponse,
  ref: string,
  topic: string,
  baseline: { topic: string; clientData?: unknown } | null
): { topic: string; clientData?: unknown } | null {
  const entry = snapshot.resources?.session?.[ref] as CollectionSnapshotEntry | undefined;
  const liveEntry = entry?.live?.[topic];
  if (liveEntry === undefined) return baseline;
  if (liveEntry.deleted === true) return null;
  if (baseline !== null) return { ...baseline, clientData: liveEntry.clientData };
  return { topic, clientData: liveEntry.clientData };
}

describe("useResourceCollectionItem live overlay (FIX-739)", () => {
  const baseSnapshot: SessionStateSnapshotResponse = {
    sessionId: "sess",
    flowKind: "test",
    clientData: {},
    resources: { session: { memos: { count: 1 } } },
  };

  it("overlays the merged live delta over the fetched baseline without a refetch", () => {
    const baseline = { topic: "m1", clientData: { status: "pending" } };
    // No overlay yet → baseline passes through.
    expect(readItem(baseSnapshot, "memos", "m1", baseline)).toEqual(baseline);

    // A live mutation arrives; the reducer folds it into the snapshot.
    const merged = mergeResourceChangeIntoSnapshot(baseSnapshot, liveChange("memos/m1", { status: "writing" }))!;
    expect(readItem(merged, "memos", "m1", baseline).clientData).toEqual({ status: "writing" });

    // A second mutation updates the overlay again — still no new baseline fetch.
    const merged2 = mergeResourceChangeIntoSnapshot(merged, liveChange("memos/m1", { status: "published" }))!;
    expect(readItem(merged2, "memos", "m1", baseline).clientData).toEqual({ status: "published" });
  });

  it("leaves a different topic's baseline untouched", () => {
    const merged = mergeResourceChangeIntoSnapshot(baseSnapshot, liveChange("memos/m1", { status: "writing" }))!;
    const otherBaseline = { topic: "m2", clientData: { status: "pending" } };
    expect(readItem(merged, "memos", "m2", otherBaseline)).toEqual(otherBaseline);
  });

  it("surfaces an overlay even when the baseline hasn't loaded (no refetch needed)", () => {
    // Bug: a create/update that arrives before the HTTP baseline resolves must
    // not be dropped. With baseline null, the overlay still produces an item.
    const merged = mergeResourceChangeIntoSnapshot(baseSnapshot, liveChange("memos/m1", { status: "writing" }))!;
    expect(readItem(merged, "memos", "m1", null)).toEqual({ topic: "m1", clientData: { status: "writing" } });
  });

  it("shows the item as gone on a live delete without flashing the stale baseline", () => {
    // Bug: a delete must not fall back to the last-fetched baseline. The
    // tombstone makes the hook return null immediately.
    const writing = mergeResourceChangeIntoSnapshot(baseSnapshot, liveChange("memos/m1", { status: "writing" }))!;
    const deleted = mergeResourceChangeIntoSnapshot(
      writing,
      { ...liveChange("memos/m1", null), changeType: "deleted" }
    )!;
    const staleBaseline = { topic: "m1", clientData: { status: "pending" } };
    expect(readItem(deleted, "memos", "m1", staleBaseline)).toBeNull();
  });
});
