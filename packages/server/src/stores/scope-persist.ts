/**
 * Builds a CAS persist callback for a scope record.
 *
 * Inspects the `CASMutationHint` on each invocation and routes single-field
 * state writes to the store's delta verbs (`patchField` / `incField` /
 * `pushToArray`) when implemented, falling back to a full `set` of the
 * record otherwise. Multi-field patches, `setState`, and record-level
 * mutations always go through `set` per the FIX-405 decision tree —
 * decomposing them into N delta calls would bump the version counter per
 * field and break single-version semantics for one logical mutation.
 *
 * `buildSetRecord` constructs the full record for the `set` fallback path;
 * the delta paths reuse the mutator's `nextState` to build the local ref
 * update on success. On conflict `ref.current` is refreshed to the store's
 * current record so the next CAS attempt sees a fresh baseline.
 */

import type { CASPersist, CASPersistResult } from "./cas";
import type {
  DeltaStoreOps,
  ExpectedVersion,
  SetResult
} from "./types";

export type ScopeStoreLike<TRecord> = DeltaStoreOps<TRecord> & {
  set(
    id: string,
    value: TRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<TRecord>>;
};

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
  ) => TRecord
): CASPersist<TState> {
  return async (state, expectedVersion, hint) => {
    const id = ref.current.id;
    // One Date.now() shared between the delta-verb call (so the DB row
    // stores it) and the local ref update (so consumers reading
    // ref.current.updatedAt see the same value the DB holds). The `set`
    // fallback path doesn't use this — `buildSetRecord` captures its own
    // Date.now() inside the full record it constructs.
    const updatedAt = Date.now();

    const handleResult = (
      result: SetResult<TRecord>,
      buildLocalNext: (version: number) => TRecord
    ): CASPersistResult<TState> => {
      if (result.ok) {
        ref.current = buildLocalNext(result.version);
        return { ok: true, version: result.version };
      }
      const current = result.conflict.currentValue;
      if (current !== undefined) {
        ref.current = current;
      }
      return {
        ok: false,
        currentState: current?.state as TState | undefined,
        currentVersion: result.conflict.currentVersion
      };
    };

    const buildDeltaLocal = (version: number): TRecord => ({
      ...ref.current,
      state: state as TRecord["state"],
      version,
      updatedAt
    });

    if (hint.kind === "patchField" && typeof store.patchField === "function") {
      const value = (state as Record<string, unknown>)[hint.path[0]];
      const result = await store.patchField(
        id,
        hint.path,
        value,
        expectedVersion,
        updatedAt
      );
      return handleResult(result, buildDeltaLocal);
    }

    if (hint.kind === "incField" && typeof store.incField === "function") {
      const result = await store.incField(
        id,
        hint.path,
        hint.delta,
        expectedVersion,
        updatedAt
      );
      return handleResult(result, buildDeltaLocal);
    }

    if (
      hint.kind === "pushToArray" &&
      typeof store.pushToArray === "function"
    ) {
      const result = await store.pushToArray(
        id,
        hint.path,
        hint.values,
        expectedVersion,
        updatedAt
      );
      return handleResult(result, buildDeltaLocal);
    }

    // Fallback: full set. Used for `set` hints and for delta hints when the
    // adapter doesn't advertise the relevant verb (capability advertisement).
    const nextRecord = buildSetRecord(expectedVersion, state);
    const result = await store.set(id, nextRecord, expectedVersion);
    return handleResult(result, () => nextRecord);
  };
}
