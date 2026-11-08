// FIX-405.
/**
 * Builds a CAS persist callback for a scope record.
 *
 * Inspects the `CASMutationHint` on each invocation and routes single-field
 * state writes to the store's delta verbs (`patchField` / `incField` /
 * `pushToArray`) when implemented, falling back to a full `set` of the
 * record otherwise. Multi-field patches, `setState`, and record-level
 * mutations always go through `set` —
 * decomposing them into N delta calls would bump the version counter per
 * field and break single-version semantics for one logical mutation.
 *
 * `buildSetRecord` constructs the full record for the `set` fallback path;
 * the delta paths reuse the mutator's `nextState` to build the local ref
 * update on success. On conflict `ref.current` is refreshed to the store's
 * current record so the next CAS attempt sees a fresh baseline.
 */

import type { CASPersist, CASPersistResult, CASReread } from "./cas";
import { isCommutativeHint } from "./cas";
import type { CASMutationHint } from "./cas";
import type {
  DeltaStoreOps,
  ExpectedVersion,
  SetResult
} from "./types";

function toNestedValue(state: unknown, field: string, key: string): unknown {
  const obj = state as Record<string, Record<string, unknown>>;
  return obj?.[field]?.[key];
}

/**
 * Attempts for an increment or push onto a field that reads as its default.
 * A lost race leaves the winner's write in the store, usually with the field
 * now stored, so the next attempt takes the atomic delta.
 */
const MAX_ADDITIVE_ATTEMPTS = 4;

/** Re-applies an increment or push to `state`, as `incState` / `pushState` do. */
function applyAdditive<TState>(
  state: TState,
  hint: Extract<CASMutationHint, { kind: "incField" | "pushToArray" }>
): TState {
  const next = { ...(state as Record<string, unknown>) };
  const field = hint.path[0];
  const current = next[field];
  next[field] =
    hint.kind === "incField"
      ? (typeof current === "number" ? current : 0) + hint.delta
      : [...(Array.isArray(current) ? current : []), ...hint.values];
  return next as TState;
}

export type ScopeStoreLike<TRecord> = DeltaStoreOps<TRecord> & {
  set(
    id: string,
    value: TRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<TRecord>>;
};

/**
 * `persist` for a scope record (see `RunWithCASOptions.persist`). `readState`
 * maps a stored record's state to what the scope reads, applied to the record a
 * delta write returns and to the one a conflict reports, the same way the
 * scope's initial load did (the scope's schema defaults).
 */
export function createScopePersist<
  TState,
  TRecord extends {
    id: string;
    state: unknown;
    version: number;
    updatedAt: number;
  }
>(
  ref: { current: TRecord },
  store: ScopeStoreLike<TRecord>,
  buildSetRecord: (
    expectedVersion: number,
    state: Readonly<TState>
  ) => TRecord,
  readState: (state: unknown) => TState = (state) => state as TState
): CASPersist<TState> {
  return async (state, expectedVersion, hint) => {
    const id = ref.current.id;
    const updatedAt = Date.now();
    const commutative = isCommutativeHint(hint);
    const effectiveVersion: ExpectedVersion = commutative ? "any" : expectedVersion;

    const handleResult = (
      result: SetResult<TRecord>,
      buildLocalNext: (version: number) => TRecord
    ): CASPersistResult<TState> => {
      if (result.ok) {
        // On the commutative path, prefer the store-returned record (it
        // reflects concurrent writers' changes). On the CAS path, build
        // the local next from the mutator output as before.
        const next = result.record ?? buildLocalNext(result.version);
        ref.current = next;
        return {
          ok: true,
          version: result.version,
          record: readState(next.state)
        };
      }
      const current = result.conflict.currentValue;
      if (current !== undefined) {
        ref.current = current;
      }
      return {
        ok: false,
        currentState: current === undefined ? undefined : readState(current.state),
        currentVersion: result.conflict.currentVersion
      };
    };

    const buildDeltaLocal = (version: number): TRecord => ({
      ...ref.current,
      state: state as TRecord["state"],
      version,
      updatedAt
    });

    // A store's `incField` / `pushToArray` start a field the record lacks at
    // 0 / []. When the scope reads that field as its schema default instead,
    // the delta would drop the default, so the write is a version-checked full
    // `set` carrying the defaulted value. That `set` can lose to a concurrent
    // writer, and the caller (`runCommutative`) does not retry, so a lost race
    // is retried here: the hint alone says what to add, so it is re-applied to
    // the store's current record. Once the field is stored, the atomic delta
    // takes over and builds on it as usual.
    const readsDefault = (field: string): boolean => {
      const stored = ref.current.state as Record<string, unknown> | undefined;
      if (stored?.[field] !== undefined) return false;
      return (readState(ref.current.state) as Record<string, unknown>)[field] !== undefined;
    };

    const persistAdditive = async (
      additive: Extract<CASMutationHint, { kind: "incField" | "pushToArray" }>,
      proposed: TState,
      expected: number
    ): Promise<CASPersistResult<TState>> => {
      const field = additive.path[0];
      for (let attempt = 1; ; attempt++) {
        if (!readsDefault(field)) {
          const next = proposed;
          const buildLocal = (version: number): TRecord => ({
            ...ref.current,
            state: next as TRecord["state"],
            version,
            updatedAt
          });
          const result =
            additive.kind === "incField"
              ? await store.incField!(id, additive.path, additive.delta, effectiveVersion, updatedAt)
              : await store.pushToArray!(id, additive.path, additive.values, effectiveVersion, updatedAt);
          return handleResult(result, buildLocal);
        }
        const nextRecord = buildSetRecord(expected, proposed);
        const result = await store.set(id, nextRecord, expected);
        const current = result.ok ? undefined : result.conflict.currentValue;
        if (current === undefined || attempt === MAX_ADDITIVE_ATTEMPTS) {
          return handleResult(result, () => nextRecord);
        }
        ref.current = current;
        expected = current.version;
        proposed = applyAdditive(readState(current.state), additive);
      }
    };

    if (hint.kind === "patchField" && typeof store.patchField === "function") {
      const value = hint.path.length === 2
        ? (toNestedValue(state, hint.path[0], hint.path[1]))
        : (state as Record<string, unknown>)[hint.path[0]];
      const result = await store.patchField(
        id,
        hint.path,
        value,
        effectiveVersion,
        updatedAt
      );
      return handleResult(result, buildDeltaLocal);
    }

    if (
      (hint.kind === "incField" && typeof store.incField === "function") ||
      (hint.kind === "pushToArray" && typeof store.pushToArray === "function")
    ) {
      return persistAdditive(hint, state, expectedVersion);
    }

    if (hint.kind === "deleteField" && typeof store.deleteField === "function") {
      const result = await store.deleteField(
        id,
        hint.path,
        effectiveVersion,
        updatedAt
      );
      return handleResult(result, buildDeltaLocal);
    }

    // Fallback: full set. Used for `set` hints, for delta hints when the
    // adapter doesn't advertise the relevant verb (capability advertisement).
    const nextRecord = buildSetRecord(expectedVersion, state);
    const result = await store.set(id, nextRecord, expectedVersion);
    return handleResult(result, () => nextRecord);
  };
}

/**
 * `reread` for a scope record (see `RunWithCASOptions.reread`). `undefined`
 * when the ref or the stored record is gone. Refreshes `ref.current` when the
 * stored record is newer than the one held when the read returns, so the
 * retry's full-record `set` is built from the stored record. A write that
 * landed during the read keeps its newer record. `readState` maps the stored
 * state to what the scope reads, the same way its initial load did (the
 * scope's schema defaults).
 */
export function createScopeReread<
  TState,
  TRecord extends { id: string; state: unknown; version: number }
>(
  ref: { current: TRecord | undefined },
  store: { get(id: string): Promise<TRecord | undefined> },
  readState: (state: unknown) => TState = (state) => state as TState
): CASReread<TState> {
  return async () => {
    const held = ref.current;
    if (held === undefined) return undefined;
    const record = await store.get(held.id);
    if (record === undefined) return undefined;
    const latest = ref.current;
    if (latest === undefined || record.version > latest.version) {
      ref.current = record;
    }
    return { state: readState(record.state), version: record.version };
  };
}
