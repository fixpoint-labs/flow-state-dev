/**
 * Pure reducer that folds a `state_change` SSE item into the React layer's
 * cached `SessionStateSnapshotResponse`, so `useClientData` can surface
 * mid-stream session/user/org-scope updates without waiting for terminal
 * status (FIX-576).
 *
 * Why "only merge keys already present in clientData[scope]": `clientData` is
 * the projected slice of scope state — the server filters down to the flow's
 * `expose` list (plus computed `derived` values) before sending the snapshot.
 * The on-the-wire `state_change` delta carries the *raw* keys the block
 * patched, including non-exposed ones. To avoid leaking those non-exposed
 * keys into `clientData[scope]`, we only update keys the initial snapshot
 * already populated. Trade-off: the first set of an expose key whose initial
 * value was `undefined` won't land mid-stream; declare a default in the
 * scope's `stateSchema` if that case matters. Derived projections aren't
 * addressable from a delta and stay stale until the terminal-status snapshot
 * refresh either way.
 *
 * Atomic mutations (`operation: "atomic"`) carry no structured delta and are
 * ignored here.
 */
import type { SessionStateSnapshotResponse } from "@flow-state-dev/client";
import type { OutputItem, StateChangeItem } from "@flow-state-dev/core/items";

type ReducibleScope = "session" | "user" | "org";

const REDUCIBLE_SCOPES: ReadonlySet<string> = new Set<ReducibleScope>([
  "session",
  "user",
  "org"
]);

export function isReducibleStateChange(
  item: OutputItem
): item is StateChangeItem & { scope: ReducibleScope } {
  if (item.type !== "state_change") {
    return false;
  }
  return REDUCIBLE_SCOPES.has((item as StateChangeItem).scope);
}

function shallowEqualObject(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function reduceScopeData(
  prevScope: Record<string, unknown> | undefined,
  sc: StateChangeItem
): Record<string, unknown> | undefined {
  // No projected-slice anchor yet — refuse to surface anything until the
  // initial snapshot fetch lands and tells us which keys are exposed.
  if (prevScope === undefined) return prevScope;
  const prev = prevScope;
  switch (sc.operation) {
    case "patch": {
      // patchState(key, updater) emits delta `{ path: <keyName> }` with no
      // resolved value — nothing to merge. Distinguished from setStateRecord
      // by `delta.path` being a string keyName here vs. an object record
      // there.
      if (typeof sc.path === "string" && sc.delta !== undefined) {
        const d = sc.delta as Record<string, unknown>;
        if (
          d !== null &&
          typeof d === "object" &&
          Object.keys(d).length === 1 &&
          hasOwn(d, "path") &&
          typeof d.path === "string"
        ) {
          return prev;
        }
      }
      // setStateRecord emits delta `{ [field]: { [key]: value } }` and
      // `path: "field.key"`. Only update if `field` is already exposed.
      if (typeof sc.path === "string" && sc.path.includes(".")) {
        const [field, key] = sc.path.split(".", 2);
        if (!hasOwn(prev, field)) return prev;
        const delta = sc.delta as Record<string, unknown> | undefined;
        const fieldDelta = delta?.[field] as Record<string, unknown> | undefined;
        if (fieldDelta === undefined) return prev;
        const currentField = prev[field];
        const baseField = (
          typeof currentField === "object" && currentField !== null
            ? currentField
            : {}
        ) as Record<string, unknown>;
        const nextField = { ...baseField, [key]: fieldDelta[key] };
        return { ...prev, [field]: nextField };
      }
      const delta = sc.delta as Record<string, unknown> | undefined;
      if (delta === undefined || typeof delta !== "object" || delta === null) {
        return prev;
      }
      // Restrict the merge to keys already exposed in clientData[scope].
      const next: Record<string, unknown> = { ...prev };
      let changed = false;
      for (const k of Object.keys(delta)) {
        if (!hasOwn(prev, k)) continue;
        if (next[k] !== delta[k]) {
          next[k] = delta[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    }
    case "set": {
      const delta = sc.delta as Record<string, unknown> | undefined;
      if (delta === undefined || typeof delta !== "object" || delta === null) {
        return prev;
      }
      // setState replaces raw scope state, but `clientData[scope]` is a
      // projection — only the exposed keys of the new state apply, and any
      // derived projections we don't recompute stay as-is until terminal
      // refresh.
      const next: Record<string, unknown> = { ...prev };
      let changed = false;
      for (const k of Object.keys(prev)) {
        if (!hasOwn(delta, k)) continue;
        if (next[k] !== delta[k]) {
          next[k] = delta[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    }
    case "increment": {
      const delta = sc.delta as Record<string, number> | undefined;
      if (delta === undefined) return prev;
      const next: Record<string, unknown> = { ...prev };
      let changed = false;
      for (const [key, inc] of Object.entries(delta)) {
        if (typeof inc !== "number") continue;
        if (!hasOwn(prev, key)) continue;
        const cur = next[key];
        if (typeof cur !== "number") continue;
        next[key] = cur + inc;
        changed = true;
      }
      return changed ? next : prev;
    }
    case "push": {
      if (typeof sc.path !== "string") return prev;
      if (!hasOwn(prev, sc.path)) return prev;
      const cur = prev[sc.path];
      if (!Array.isArray(cur)) return prev;
      return { ...prev, [sc.path]: [...cur, sc.delta] };
    }
    case "delete_key": {
      if (typeof sc.path !== "string" || !sc.path.includes(".")) return prev;
      const [field, key] = sc.path.split(".", 2);
      if (!hasOwn(prev, field)) return prev;
      const cur = prev[field];
      if (typeof cur !== "object" || cur === null) return prev;
      const record = cur as Record<string, unknown>;
      if (!hasOwn(record, key)) return prev;
      const nextField: Record<string, unknown> = { ...record };
      delete nextField[key];
      return { ...prev, [field]: nextField };
    }
    case "atomic":
      return prev;
    default:
      return prev;
  }
}

/**
 * Returns a new snapshot with `clientData[sc.scope]` merged from the delta,
 * or the original snapshot reference unchanged when the delta yields no
 * observable difference. Returns `prev` unchanged when no snapshot exists yet
 * (the reducer relies on the upcoming initial-fetch result to seed state).
 */
export function mergeStateChangeIntoSnapshot(
  prev: SessionStateSnapshotResponse | null,
  sc: StateChangeItem
): SessionStateSnapshotResponse | null {
  if (prev === null) return prev;
  if (!REDUCIBLE_SCOPES.has(sc.scope)) return prev;
  const scope = sc.scope as ReducibleScope;

  const currentScopeData = prev.clientData[scope];
  const nextScopeData = reduceScopeData(currentScopeData, sc);

  if (nextScopeData === currentScopeData) {
    return prev;
  }
  if (
    currentScopeData !== undefined &&
    nextScopeData !== undefined &&
    shallowEqualObject(currentScopeData, nextScopeData)
  ) {
    return prev;
  }

  return {
    ...prev,
    clientData: {
      ...prev.clientData,
      [scope]: nextScopeData
    }
  };
}
