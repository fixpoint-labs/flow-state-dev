const REDUCIBLE_SCOPES = new Set([
    "session",
    "user",
    "org"
]);
export function isReducibleStateChange(item) {
    if (item.type !== "state_change") {
        return false;
    }
    return REDUCIBLE_SCOPES.has(item.scope);
}
function shallowEqualObject(a, b) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length)
        return false;
    for (const k of aKeys) {
        if (!Object.prototype.hasOwnProperty.call(b, k))
            return false;
        if (a[k] !== b[k])
            return false;
    }
    return true;
}
function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}
function reduceScopeData(prevScope, sc) {
    // No projected-slice anchor yet — refuse to surface anything until the
    // initial snapshot fetch lands and tells us which keys are exposed.
    if (prevScope === undefined)
        return prevScope;
    const prev = prevScope;
    switch (sc.operation) {
        case "patch": {
            // patchState(key, updater) emits delta `{ path: <keyName> }` with no
            // resolved value — nothing to merge. Distinguished from setStateRecord
            // by `delta.path` being a string keyName here vs. an object record
            // there.
            if (typeof sc.path === "string" && sc.delta !== undefined) {
                const d = sc.delta;
                if (d !== null &&
                    typeof d === "object" &&
                    Object.keys(d).length === 1 &&
                    hasOwn(d, "path") &&
                    typeof d.path === "string") {
                    return prev;
                }
            }
            // setStateRecord emits delta `{ [field]: { [key]: value } }` and
            // `path: "field.key"`. Only update if `field` is already exposed.
            if (typeof sc.path === "string" && sc.path.includes(".")) {
                const [field, key] = sc.path.split(".", 2);
                if (!hasOwn(prev, field))
                    return prev;
                const delta = sc.delta;
                const fieldDelta = delta?.[field];
                if (fieldDelta === undefined)
                    return prev;
                const currentField = prev[field];
                const baseField = (typeof currentField === "object" && currentField !== null
                    ? currentField
                    : {});
                const nextField = { ...baseField, [key]: fieldDelta[key] };
                return { ...prev, [field]: nextField };
            }
            const delta = sc.delta;
            if (delta === undefined || typeof delta !== "object" || delta === null) {
                return prev;
            }
            // Restrict the merge to keys already exposed in clientData[scope].
            const next = { ...prev };
            let changed = false;
            for (const k of Object.keys(delta)) {
                if (!hasOwn(prev, k))
                    continue;
                if (next[k] !== delta[k]) {
                    next[k] = delta[k];
                    changed = true;
                }
            }
            return changed ? next : prev;
        }
        case "set": {
            const delta = sc.delta;
            if (delta === undefined || typeof delta !== "object" || delta === null) {
                return prev;
            }
            // setState replaces raw scope state, but `clientData[scope]` is a
            // projection — only the exposed keys of the new state apply.
            const next = { ...prev };
            let changed = false;
            for (const k of Object.keys(prev)) {
                if (!hasOwn(delta, k))
                    continue;
                if (next[k] !== delta[k]) {
                    next[k] = delta[k];
                    changed = true;
                }
            }
            return changed ? next : prev;
        }
        case "increment": {
            const delta = sc.delta;
            if (delta === undefined)
                return prev;
            const next = { ...prev };
            let changed = false;
            for (const [key, inc] of Object.entries(delta)) {
                if (typeof inc !== "number")
                    continue;
                if (!hasOwn(prev, key))
                    continue;
                const cur = next[key];
                if (typeof cur !== "number")
                    continue;
                next[key] = cur + inc;
                changed = true;
            }
            return changed ? next : prev;
        }
        case "push": {
            if (typeof sc.path !== "string")
                return prev;
            if (!hasOwn(prev, sc.path))
                return prev;
            const cur = prev[sc.path];
            if (!Array.isArray(cur))
                return prev;
            return { ...prev, [sc.path]: [...cur, sc.delta] };
        }
        case "delete_key": {
            if (typeof sc.path !== "string" || !sc.path.includes("."))
                return prev;
            const [field, key] = sc.path.split(".", 2);
            if (!hasOwn(prev, field))
                return prev;
            const cur = prev[field];
            if (typeof cur !== "object" || cur === null)
                return prev;
            const record = cur;
            if (!hasOwn(record, key))
                return prev;
            const nextField = { ...record };
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
 * Whether applying `sc` again over state that already holds it lands the
 * same, and the reducer can apply it at all: `set`, `delete_key`, and a
 * `patch` that carries its values. Not `increment` or `push` (they would
 * count twice), nor `atomic` or a `patchState(key, updater)` patch (no
 * value to apply, so the reducer leaves state as it was).
 */
export function isReplayableStateChange(sc) {
    if (sc.operation === "set" || sc.operation === "delete_key")
        return true;
    if (sc.operation !== "patch")
        return false;
    const d = sc.delta;
    const isUpdaterPatch = typeof sc.path === "string" &&
        d !== null &&
        typeof d === "object" &&
        Object.keys(d).length === 1 &&
        hasOwn(d, "path") &&
        typeof d.path === "string";
    return !isUpdaterPatch;
}
/**
 * Returns a new snapshot with `clientData[sc.scope]` merged from the delta,
 * or the original snapshot reference unchanged when the delta yields no
 * observable difference. Returns `prev` unchanged when no snapshot exists yet
 * (the reducer relies on the upcoming initial-fetch result to seed state).
 */
export function mergeStateChangeIntoSnapshot(prev, sc) {
    if (prev === null)
        return prev;
    if (!REDUCIBLE_SCOPES.has(sc.scope))
        return prev;
    const scope = sc.scope;
    const currentScopeData = prev.clientData[scope];
    const nextScopeData = reduceScopeData(currentScopeData, sc);
    if (nextScopeData === currentScopeData) {
        return prev;
    }
    if (currentScopeData !== undefined &&
        nextScopeData !== undefined &&
        shallowEqualObject(currentScopeData, nextScopeData)) {
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
//# sourceMappingURL=mergeStateChangeIntoSnapshot.js.map