/**
 * Pure reducer that folds a `live: true` `resource_change` SSE item into the
 * React layer's cached `SessionStateSnapshotResponse`, so `useResource` and
 * `useCollectionResource` surface mid-stream resource updates without an
 * HTTP refetch. The resource-side analog of
 * `mergeStateChangeIntoSnapshot`.
 *
 * Unlike `state_change`, a resource delta is the **full projected `clientData`**
 * for the post-mutation state (last-write-wins), not an operation-based patch —
 * so this reducer just replaces the stored projection. Only items carrying a
 * `delta` (i.e. emitted by a `live` resource) are reducible; default
 * resource_change items carry no delta and stay on the batched-refetch path.
 *
 * Locating the target from `resourcePath` mirrors the existing
 * `pathAffectsCollection` convention: a snapshot key that exactly equals the
 * path is a single resource; a snapshot key that is a `/`-prefix of the path is
 * a collection, with the remainder as the item topic. When no snapshot entry
 * anchors the path yet, the reducer is a no-op — the value reconciles at the
 * terminal-status refetch (same as the state reducer's absent-anchor case).
 */
import type { SessionStateSnapshotResponse } from "@flow-state-dev/client";
import type { OutputItem, ResourceChangeItem } from "@flow-state-dev/core/items";
/**
 * True when `item` is a `resource_change` carrying an inline `delta` in a
 * reducible scope — i.e. emitted by a `client.live: true` resource. Default
 * (deltaless) resource_change items are not reducible; they drive the batched
 * refetch instead. Returns a plain boolean (not a type predicate) so call
 * sites that have already discriminated `type === "resource_change"` keep the
 * item's type in both branches.
 */
export declare function isReducibleResourceChange(item: OutputItem): boolean;
/**
 * Returns a new snapshot with the resource delta folded into
 * `resources[scope][ref]` (single) or `resources[scope][ref].live[topic]`
 * (collection item), or the original `prev` reference when the change yields no
 * observable difference or no snapshot entry anchors the path yet.
 */
export declare function mergeResourceChangeIntoSnapshot(prev: SessionStateSnapshotResponse | null, rc: ResourceChangeItem): SessionStateSnapshotResponse | null;
//# sourceMappingURL=mergeResourceChangeIntoSnapshot.d.ts.map