/**
 * Pure reducer that folds a `live: true` `resource_change` SSE item into the
 * React layer's cached `SessionStateSnapshotResponse`, so `useResource` and
 * `useResourceCollectionItem` surface mid-stream resource updates without an
 * HTTP refetch (FIX-739). The resource-side analog of
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
import type {
  CollectionSnapshotEntry,
  ResourceSnapshotEntry,
  SessionStateSnapshotResponse,
} from "@flow-state-dev/client";
import type { OutputItem, ResourceChangeItem } from "@flow-state-dev/core/items";

type ReducibleScope = "session" | "user" | "org";

const REDUCIBLE_SCOPES: ReadonlySet<string> = new Set<ReducibleScope>([
  "session",
  "user",
  "org",
]);

/**
 * True when `item` is a `resource_change` carrying an inline `delta` in a
 * reducible scope — i.e. emitted by a `client.live: true` resource. Default
 * (deltaless) resource_change items are not reducible; they drive the batched
 * refetch instead. Returns a plain boolean (not a type predicate) so call
 * sites that have already discriminated `type === "resource_change"` keep the
 * item's type in both branches.
 */
export function isReducibleResourceChange(item: OutputItem): boolean {
  if (item.type !== "resource_change") return false;
  const rc = item as ResourceChangeItem;
  return rc.delta !== undefined && REDUCIBLE_SCOPES.has(rc.scope);
}

/** A snapshot resource key and, for collection items, the captured topic. */
type Located =
  | { kind: "single"; ref: string }
  | { kind: "collection"; ref: string; topic: string };

function locate(
  scopeResources: Record<string, ResourceSnapshotEntry | CollectionSnapshotEntry>,
  resourcePath: string
): Located | undefined {
  // Exact match → single resource. Checked first so a single named `memos`
  // wins over a hypothetical collection prefix collision.
  if (Object.prototype.hasOwnProperty.call(scopeResources, resourcePath)) {
    return { kind: "single", ref: resourcePath };
  }
  for (const ref of Object.keys(scopeResources)) {
    if (resourcePath.startsWith(`${ref}/`)) {
      return { kind: "collection", ref, topic: resourcePath.slice(ref.length + 1) };
    }
  }
  return undefined;
}

/**
 * Returns a new snapshot with the resource delta folded into
 * `resources[scope][ref]` (single) or `resources[scope][ref].live[topic]`
 * (collection item), or the original `prev` reference when the change yields no
 * observable difference or no snapshot entry anchors the path yet.
 */
export function mergeResourceChangeIntoSnapshot(
  prev: SessionStateSnapshotResponse | null,
  rc: ResourceChangeItem
): SessionStateSnapshotResponse | null {
  if (prev === null) return prev;
  if (!REDUCIBLE_SCOPES.has(rc.scope)) return prev;
  const scope = rc.scope as ReducibleScope;

  const scopeResources = prev.resources?.[scope];
  if (scopeResources === undefined) return prev;

  const located = locate(scopeResources, rc.resourcePath);
  if (located === undefined) return prev;

  if (located.kind === "single") {
    // Single resources only ever emit `updated` deltas (static singles have no
    // delete/create on the live path), so this just replaces the projection.
    const entry = scopeResources[located.ref] as ResourceSnapshotEntry;
    if (entry.clientData === rc.delta) return prev;
    const nextEntry: ResourceSnapshotEntry = { ...entry, clientData: rc.delta };
    return replaceEntry(prev, scope, scopeResources, located.ref, nextEntry);
  }

  // Collection item.
  const entry = scopeResources[located.ref] as CollectionSnapshotEntry;
  const live = entry.live ?? {};
  if (rc.changeType === "deleted") {
    if (!(located.topic in live)) {
      // Topic was never overlaid; still reflect the cardinality drop so the
      // count stays roughly live until the terminal refetch.
      if (entry.count === undefined) return prev;
      const nextEntry: CollectionSnapshotEntry = {
        ...entry,
        count: Math.max(0, entry.count - 1),
      };
      return replaceEntry(prev, scope, scopeResources, located.ref, nextEntry);
    }
    const nextLive = { ...live };
    delete nextLive[located.topic];
    const nextEntry: CollectionSnapshotEntry = {
      ...entry,
      live: nextLive,
      count: entry.count === undefined ? undefined : Math.max(0, entry.count - 1),
    };
    return replaceEntry(prev, scope, scopeResources, located.ref, nextEntry);
  }

  // created / updated → set the overlay; bump count on a first-seen create.
  const existing = live[located.topic];
  if (existing !== undefined && existing.clientData === rc.delta) return prev;
  const isNewTopic = rc.changeType === "created" && existing === undefined;
  const nextEntry: CollectionSnapshotEntry = {
    ...entry,
    live: { ...live, [located.topic]: { clientData: rc.delta } },
    count: isNewTopic && entry.count !== undefined ? entry.count + 1 : entry.count,
  };
  return replaceEntry(prev, scope, scopeResources, located.ref, nextEntry);
}

function replaceEntry(
  prev: SessionStateSnapshotResponse,
  scope: ReducibleScope,
  scopeResources: Record<string, ResourceSnapshotEntry | CollectionSnapshotEntry>,
  ref: string,
  nextEntry: ResourceSnapshotEntry | CollectionSnapshotEntry
): SessionStateSnapshotResponse {
  return {
    ...prev,
    resources: {
      ...prev.resources,
      [scope]: { ...scopeResources, [ref]: nextEntry },
    },
  };
}
