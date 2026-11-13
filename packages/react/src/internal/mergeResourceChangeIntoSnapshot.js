const REDUCIBLE_SCOPES = new Set([
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
export function isReducibleResourceChange(item) {
    if (item.type !== "resource_change")
        return false;
    const rc = item;
    return rc.delta !== undefined && REDUCIBLE_SCOPES.has(rc.scope);
}
function locate(scopeResources, resourcePath) {
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
export function mergeResourceChangeIntoSnapshot(prev, rc) {
    if (prev === null)
        return prev;
    if (!REDUCIBLE_SCOPES.has(rc.scope))
        return prev;
    const scope = rc.scope;
    const scopeResources = prev.resources?.[scope];
    if (scopeResources === undefined)
        return prev;
    const located = locate(scopeResources, rc.resourcePath);
    if (located === undefined)
        return prev;
    if (located.kind === "single") {
        // Single resources only ever emit `updated` deltas (static singles have no
        // delete/create on the live path), so this just replaces the projection.
        const entry = scopeResources[located.ref];
        if (entry.clientData === rc.delta)
            return prev;
        const nextEntry = { ...entry, clientData: rc.delta };
        return replaceEntry(prev, scope, scopeResources, located.ref, nextEntry);
    }
    // Collection item — fold the change into the per-topic overlay. A delete
    // writes a tombstone (rather than removing the key) so the hook can show the
    // item as gone immediately, instead of falling back to the stale HTTP
    // baseline. `count` is intentionally left untouched: it reconciles at the
    // terminal-status refetch (useSession flags one on create/delete), and
    // adjusting it here would trip useResourceCollection's count-watch into a
    // mid-stream refetch, defeating the refetch-free path.
    const entry = scopeResources[located.ref];
    const live = entry.live ?? {};
    const existing = live[located.topic];
    const nextOverlay = rc.changeType === "deleted" ? { deleted: true } : { clientData: rc.delta };
    if (existing !== undefined &&
        existing.deleted === nextOverlay.deleted &&
        existing.clientData === nextOverlay.clientData) {
        return prev;
    }
    const nextEntry = {
        ...entry,
        live: { ...live, [located.topic]: nextOverlay },
    };
    return replaceEntry(prev, scope, scopeResources, located.ref, nextEntry);
}
function replaceEntry(prev, scope, scopeResources, ref, nextEntry) {
    return {
        ...prev,
        resources: {
            ...prev.resources,
            [scope]: { ...scopeResources, [ref]: nextEntry },
        },
    };
}
//# sourceMappingURL=mergeResourceChangeIntoSnapshot.js.map