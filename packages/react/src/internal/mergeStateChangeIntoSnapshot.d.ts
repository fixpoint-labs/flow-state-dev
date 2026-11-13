/**
 * Pure reducer that folds a `state_change` SSE item into the React layer's
 * cached `SessionStateSnapshotResponse`, so `useClientData` can surface
 * mid-stream session/user/org-scope updates without waiting for terminal
 * status.
 *
 * Why "only merge keys already present in clientData[scope]": `clientData` is
 * the projected slice of scope state — the server filters down to the flow's
 * `expose` list before sending the snapshot.
 * The on-the-wire `state_change` delta carries the *raw* keys the block
 * patched, including non-exposed ones. To avoid leaking those non-exposed
 * keys into `clientData[scope]`, we only update keys the initial snapshot
 * already populated. Trade-off: the first set of an expose key whose initial
 * value was `undefined` won't land mid-stream; declare a default in the
 * scope's `stateSchema` if that case matters.
 *
 * Atomic mutations (`operation: "atomic"`) carry no structured delta and are
 * ignored here.
 */
import type { SessionStateSnapshotResponse } from "@flow-state-dev/client";
import type { OutputItem, StateChangeItem } from "@flow-state-dev/core/items";
type ReducibleScope = "session" | "user" | "org";
export declare function isReducibleStateChange(item: OutputItem): item is StateChangeItem & {
    scope: ReducibleScope;
};
/**
 * Whether applying `sc` again over state that already holds it lands the
 * same, and the reducer can apply it at all: `set`, `delete_key`, and a
 * `patch` that carries its values. Not `increment` or `push` (they would
 * count twice), nor `atomic` or a `patchState(key, updater)` patch (no
 * value to apply, so the reducer leaves state as it was).
 */
export declare function isReplayableStateChange(sc: StateChangeItem): boolean;
/**
 * Returns a new snapshot with `clientData[sc.scope]` merged from the delta,
 * or the original snapshot reference unchanged when the delta yields no
 * observable difference. Returns `prev` unchanged when no snapshot exists yet
 * (the reducer relies on the upcoming initial-fetch result to seed state).
 */
export declare function mergeStateChangeIntoSnapshot(prev: SessionStateSnapshotResponse | null, sc: StateChangeItem): SessionStateSnapshotResponse | null;
export {};
//# sourceMappingURL=mergeStateChangeIntoSnapshot.d.ts.map