/**
 * SQLite-backed resource state store for the SQLite adapter package.
 *
 * State — single-resource and collection-instance alike — is addressed by
 * (scope_type, scope_id, resource_key) and stored durably in the
 * `resource_state` table. SQLite has no JSONB type, so state is JSON stored as
 * TEXT: `JSON.stringify` on write, `JSON.parse` on read. Defined locally so
 * store-sqlite keeps a type-only dependency on the engine package.
 *
 * Concurrency is compare-and-swap, not last-write-wins: each row carries a
 * monotonic `version` and a `lifecycle`, deletes tombstone rather than remove,
 * and tombstones are retained. See `ResourceStateStore` for the semantics all
 * four adapters share.
 *
 * The CAS itself is a single conditional statement — the write predicates on
 * the current version and lifecycle in its `WHERE` clause, so the compare and
 * the swap are one atomic operation under SQLite's row locking. `changes === 0`
 * means the predicate did not match, which is the conflict signal; the current
 * row is then re-read to report it.
 *
 * The guards that refuse a version a verb cannot act on, and the conflict a
 * losing write reports, are the shared rule from `@flow-state-dev/core/helpers`.
 * The compare inside each write statement is this store's own statement of the
 * same rule, kept in step by the shared conformance suite.
 *
 * The store keeps index entries (`indexes`) in `resource_index` and build
 * markers in `resource_index_built`. Every write runs in one immediate
 * transaction with its index upkeep, so a row and its entries commit together
 * or not at all, and a write's marker check cannot interleave with a build's
 * begin or completion. The rule is on `ResourceStateIndexes`.
 */
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  assertDeleteExpectedVersion,
  assertSetExpectedVersion,
  resourceStateConflict
} from "@flow-state-dev/core/helpers";
import { matchesPattern, type JsonObject } from "@flow-state-dev/core/types";
import type {
  ResourceIndexBuildEntry,
  ResourceIndexBuildState,
  ResourceIndexEntry,
  ResourceStateSetOptions,
  ResourceStateStore,
  StorageScopeType,
  ExpectedVersion,
  ResourceStateRow,
  SetResult,
  VersionedResourceState
} from "@flow-state-dev/engine";

/** A row as SQLite hands it back: state is TEXT, lifecycle is unnarrowed. */
type RawRow = { state: string; version: number; lifecycle: string };

/**
 * Create a SQLite-backed `ResourceStateStore` over the provided database
 * handle.
 */
export function createSQLiteResourceStateStore(
  db: Database.Database
): ResourceStateStore {
  const getRowStmt = db.prepare(
    "SELECT state, version, lifecycle FROM resource_state " +
      "WHERE scope_type = ? AND scope_id = ? AND resource_key = ?"
  );
  // Insert only when no row exists at all. Losing this race is a terminal
  // already-exists, never a retry-overwrite — the PK does the arbitration.
  const insertStmt = db.prepare(
    "INSERT INTO resource_state (scope_type, scope_id, resource_key, state, version, lifecycle) " +
      "VALUES (?, ?, ?, ?, ?, 'live') " +
      "ON CONFLICT (scope_type, scope_id, resource_key) DO NOTHING"
  );
  // Conditional update: the predicate is the compare, the SET is the swap.
  const updateIfVersionStmt = db.prepare(
    "UPDATE resource_state SET state = ?, version = ?, lifecycle = 'live' " +
      "WHERE scope_type = ? AND scope_id = ? AND resource_key = ? " +
      "AND version = ? AND lifecycle = 'live'"
  );
  // Recreate over a tombstone, fenced on the tombstone version the caller
  // observed. "Still not live" alone is not enough: a revive racing another
  // revive-plus-delete would otherwise write a version the other generation
  // already used, which is the version reuse the retained tombstone prevents.
  const reviveIfDeletedStmt = db.prepare(
    "UPDATE resource_state SET state = ?, version = ?, lifecycle = 'live' " +
      "WHERE scope_type = ? AND scope_id = ? AND resource_key = ? " +
      "AND lifecycle != 'live' AND version = ?"
  );
  // Unconditional write for the `"any"` opt-out. The bump happens IN the
  // statement: a read-then-write is not atomic, and two concurrent `"any"`
  // writers would both compute the same next version and both commit it,
  // leaving the loser holding a version that names the winner's row.
  const upsertStmt = db.prepare(
    "INSERT INTO resource_state (scope_type, scope_id, resource_key, state, version, lifecycle) " +
      "VALUES (?, ?, ?, ?, 1, 'live') " +
      "ON CONFLICT (scope_type, scope_id, resource_key) DO UPDATE SET " +
      "state = excluded.state, version = resource_state.version + 1, lifecycle = 'live' " +
      "RETURNING version"
  );
  // Tombstone: retain the version, drop the payload. `-1` is the "any"
  // sentinel. What makes it safe is not that a real version is always >= 1 —
  // that is a fact about the versions the store produces, and the guard sits on
  // the input side. It is safe because `assertDeleteExpectedVersion` has already
  // refused every negative, so no caller-supplied value reaches this branch.
  const tombstoneIfVersionStmt = db.prepare(
    "UPDATE resource_state SET state = '{}', lifecycle = 'deleted' " +
      "WHERE scope_type = ? AND scope_id = ? AND resource_key = ? " +
      "AND lifecycle = 'live' AND (? = -1 OR version = ?) " +
      "RETURNING version"
  );
  const getAllStmt = db.prepare(
    "SELECT resource_key, state, version FROM resource_state " +
      "WHERE scope_type = ? AND scope_id = ? AND lifecycle = 'live'"
  );
  // Prefix match via substr(...) rather than LIKE — sidesteps LIKE wildcard
  // escaping (`%`/`_` are legal in resource keys). An empty prefix matches
  // every key in scope (substr(key, 1, 0) = '').
  const getByPrefixStmt = db.prepare(
    "SELECT resource_key, state, version FROM resource_state " +
      "WHERE scope_type = ? AND scope_id = ? AND lifecycle = 'live' " +
      "AND substr(resource_key, 1, length(?)) = ?"
  );
  // Scope purge: one bulk lifecycle mark, retaining every version. Not a
  // DELETE — the retained versions are what stop a straggler from the previous
  // generation matching a row in the next one.
  const deleteAllStmt = db.prepare(
    "UPDATE resource_state SET state = '{}', lifecycle = 'deleted' " +
      "WHERE scope_type = ? AND scope_id = ? AND lifecycle = 'live'"
  );
  // Scope re-creation: a real DELETE of the dead rows only, so the new
  // incarnation of a reused scope id inherits no tombstone. The inverse of
  // `deleteAllStmt` — same scope predicate, opposite lifecycle — and
  // deliberately not reachable from teardown. See `purgeTombstones` on
  // `ResourceStateStore` for what giving those versions back costs.
  const purgeTombstonesStmt = db.prepare(
    "DELETE FROM resource_state WHERE scope_type = ? AND scope_id = ? AND lifecycle = 'deleted'"
  );

  // --- index upkeep --------------------------------------------------------
  const deleteKeyEntriesStmt = db.prepare(
    "DELETE FROM resource_index WHERE scope_type = ? AND scope_id = ? AND resource_key = ?"
  );
  const deleteScopeEntriesStmt = db.prepare(
    "DELETE FROM resource_index WHERE scope_type = ? AND scope_id = ?"
  );
  const deleteTombstonedEntriesStmt = db.prepare(
    "DELETE FROM resource_index WHERE scope_type = ? AND scope_id = ? AND resource_key IN (" +
      "SELECT resource_key FROM resource_state " +
      "WHERE scope_type = ? AND scope_id = ? AND lifecycle = 'deleted')"
  );
  // OR IGNORE: a build adds entries a live write may already have made.
  const insertEntryStmt = db.prepare(
    "INSERT OR IGNORE INTO resource_index " +
      "(scope_type, scope_id, collection, index_name, value, resource_key) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const selectMarkersStmt = db.prepare(
    "SELECT collection, index_name FROM resource_index_built WHERE scope_type = ? AND scope_id = ?"
  );
  const selectMarkerStmt = db.prepare(
    "SELECT status FROM resource_index_built " +
      "WHERE scope_type = ? AND scope_id = ? AND collection = ? AND index_name = ?"
  );
  const deleteMarkerStmt = db.prepare(
    "DELETE FROM resource_index_built " +
      "WHERE scope_type = ? AND scope_id = ? AND collection = ? AND index_name = ?"
  );
  const beginBuildStmt = db.prepare(
    "INSERT INTO resource_index_built (scope_type, scope_id, collection, index_name, status, build_id) " +
      "VALUES (?, ?, ?, ?, 'building', ?) " +
      "ON CONFLICT (scope_type, scope_id, collection, index_name) " +
      "DO UPDATE SET status = 'building', build_id = excluded.build_id"
  );
  // Fenced on the build's token, not only the status: a build whose marker a
  // write cleared must not complete on the marker a later build set.
  const markBuiltStmt = db.prepare(
    "UPDATE resource_index_built SET status = 'built' " +
      "WHERE scope_type = ? AND scope_id = ? AND collection = ? AND index_name = ? " +
      "AND status = 'building' AND build_id = ?"
  );
  const findKeysStmt = db.prepare(
    "SELECT resource_key FROM resource_index " +
      "WHERE scope_type = ? AND scope_id = ? AND collection = ? AND index_name = ? AND value = ?"
  );

  /**
   * After a successful write of `resourceKey`: make its entries exactly
   * `entries`, and clear the marker of every covering index the write did not
   * list. Runs inside the write's transaction.
   */
  const keepIndexInStep = (
    scopeType: StorageScopeType,
    scopeId: string,
    resourceKey: string,
    entries: ResourceIndexEntry[]
  ): void => {
    deleteKeyEntriesStmt.run(scopeType, scopeId, resourceKey);
    const listed = new Set<string>();
    for (const entry of entries) {
      listed.add(markerId(entry.collection, entry.index));
      for (const value of new Set(entry.values)) {
        insertEntryStmt.run(scopeType, scopeId, entry.collection, entry.index, value, resourceKey);
      }
    }
    const markers = selectMarkersStmt.all(scopeType, scopeId) as Array<{
      collection: string;
      index_name: string;
    }>;
    for (const marker of markers) {
      if (listed.has(markerId(marker.collection, marker.index_name))) continue;
      if (!matchesPattern(marker.collection, resourceKey)) continue;
      deleteMarkerStmt.run(scopeType, scopeId, marker.collection, marker.index_name);
    }
  };

  const completeBuildTx = db.transaction(
    (
      scopeType: StorageScopeType,
      scopeId: string,
      collection: string,
      index: string,
      build: string,
      entries: ResourceIndexBuildEntry[]
    ): boolean => {
      if (markBuiltStmt.run(scopeType, scopeId, collection, index, build).changes === 0) return false;
      for (const entry of entries) {
        for (const value of new Set(entry.values)) {
          insertEntryStmt.run(scopeType, scopeId, collection, index, value, entry.key);
        }
      }
      return true;
    }
  ).immediate;

  /** Read the row and parse it into the shape the shared contract logic takes. */
  const readRow = (
    scopeType: StorageScopeType,
    scopeId: string,
    resourceKey: string
  ): ResourceStateRow | undefined => {
    const row = getRowStmt.get(scopeType, scopeId, resourceKey) as RawRow | undefined;
    if (row === undefined) return undefined;
    return {
      state: JSON.parse(row.state) as JsonObject,
      version: row.version,
      lifecycle: row.lifecycle === "live" ? "live" : "deleted"
    };
  };

  /**
   * The `"absent"` write: insert if no row exists at all, otherwise report the
   * row that refused it — atomically, so no concurrent revive can be mistaken
   * for the refusing row. `.immediate` (BEGIN IMMEDIATE) takes the write lock
   * up front; the default DEFERRED would not hold one across the read, which
   * is the gap being closed. See the call site for what the split let through.
   */
  const insertOrReportTx = db.transaction(
    (
      scopeType: StorageScopeType,
      scopeId: string,
      resourceKey: string,
      payload: string
    ): SetResult<JsonObject> => {
      const inserted = insertStmt.run(scopeType, scopeId, resourceKey, payload, 1);
      if (inserted.changes > 0) return { ok: true, version: 1 };
      return resourceStateConflict(readRow(scopeType, scopeId, resourceKey));
    }
  ).immediate;

  /** The row write of `set`, without its index upkeep. Runs inside `setTx`. */
  const writeRow = (
    scopeType: StorageScopeType,
    scopeId: string,
    resourceKey: string,
    payload: string,
    expectedVersion: ExpectedVersion
  ): SetResult<JsonObject> => {
    if (expectedVersion === "any") {
      const written = upsertStmt.get(scopeType, scopeId, resourceKey, payload) as {
        version: number;
      };
      return { ok: true, version: written.version };
    }

    if (expectedVersion === "absent") {
      // "No row at all" is the insert, and nothing else: the PK arbitrates,
      // and `DO NOTHING` turns any existing row — live OR tombstoned — into
      // zero changes. That is the whole difference from the `0` branch
      // below, which goes on to revive a tombstone. Deliberately one
      // statement: a read-then-insert would let a delete land in between and
      // put the write back on the resurrection path this exists to close.
      //
      // Insert and conflict-read run in ONE transaction, because the two
      // apart are a time-of-check/time-of-use split: an explicit `create()`
      // at `0` on another connection can revive the key between them, and
      // the read would then describe a LIVE row where a tombstone did the
      // refusing. `runResourceCAS` reads a conflict carrying a current value
      // as retryable, so it would re-run the mutator and apply it to the
      // recreated generation instead of throwing `ResourceDeletedError`.
      // better-sqlite3 being synchronous closes that in-process, but not
      // against a second process over the same file — which the store
      // supports — so the guarantee is taken here rather than inherited.
      return insertOrReportTx(scopeType, scopeId, resourceKey, payload);
    }

    if (expectedVersion === 0) {
      // No row at all: a plain insert at version 1. `DO NOTHING` makes a
      // lost race report zero changes rather than overwriting the winner.
      const inserted = insertStmt.run(scopeType, scopeId, resourceKey, payload, 1);
      if (inserted.changes > 0) return { ok: true, version: 1 };

      // A row exists. Recreating over a tombstone continues from its
      // version, so a version is never reused; a live row is a conflict.
      const current = readRow(scopeType, scopeId, resourceKey);
      if (current === undefined || current.lifecycle === "live") {
        return resourceStateConflict(current);
      }
      const nextVersion = current.version + 1;
      const revived = reviveIfDeletedStmt.run(
        payload,
        nextVersion,
        scopeType,
        scopeId,
        resourceKey,
        current.version
      );
      if (revived.changes === 0) {
        return resourceStateConflict(readRow(scopeType, scopeId, resourceKey));
      }
      return { ok: true, version: nextVersion };
    }

    const nextVersion = expectedVersion + 1;
    const updated = updateIfVersionStmt.run(
      payload,
      nextVersion,
      scopeType,
      scopeId,
      resourceKey,
      expectedVersion
    );
    if (updated.changes === 0) {
      return resourceStateConflict(readRow(scopeType, scopeId, resourceKey));
    }
    return { ok: true, version: nextVersion };
  };

  // The row and its index upkeep, in one immediate transaction. The nested
  // `insertOrReportTx` becomes a savepoint inside it.
  const setTx = db.transaction(
    (
      scopeType: StorageScopeType,
      scopeId: string,
      resourceKey: string,
      payload: string,
      expectedVersion: ExpectedVersion,
      entries: ResourceIndexEntry[]
    ): SetResult<JsonObject> => {
      const result = writeRow(scopeType, scopeId, resourceKey, payload, expectedVersion);
      if (result.ok) keepIndexInStep(scopeType, scopeId, resourceKey, entries);
      return result;
    }
  ).immediate;

  /** A tombstone and the removal of its entries, in one transaction. */
  const tombstoneTx = db.transaction(
    (
      scopeType: StorageScopeType,
      scopeId: string,
      resourceKey: string,
      guard: number
    ): { version: number } | undefined => {
      const marked = tombstoneIfVersionStmt.get(scopeType, scopeId, resourceKey, guard, guard) as
        | { version: number }
        | undefined;
      if (marked !== undefined) deleteKeyEntriesStmt.run(scopeType, scopeId, resourceKey);
      return marked;
    }
  ).immediate;

  const deleteAllTx = db.transaction((scopeType: StorageScopeType, scopeId: string): void => {
    deleteAllStmt.run(scopeType, scopeId);
    deleteScopeEntriesStmt.run(scopeType, scopeId);
  }).immediate;

  const purgeTombstonesTx = db.transaction((scopeType: StorageScopeType, scopeId: string): void => {
    deleteTombstonedEntriesStmt.run(scopeType, scopeId, scopeType, scopeId);
    purgeTombstonesStmt.run(scopeType, scopeId);
  }).immediate;

  return {
    async get(
      scopeType: StorageScopeType,
      scopeId: string,
      resourceKey: string
    ): Promise<VersionedResourceState | undefined> {
      const row = readRow(scopeType, scopeId, resourceKey);
      if (row === undefined || row.lifecycle !== "live") return undefined;
      return { state: row.state, version: row.version };
    },

    async set(
      scopeType: StorageScopeType,
      scopeId: string,
      resourceKey: string,
      state: JsonObject,
      expectedVersion: ExpectedVersion,
      options?: ResourceStateSetOptions
    ): Promise<SetResult<JsonObject>> {
      assertSetExpectedVersion(expectedVersion);
      const payload = JSON.stringify(state);
      return setTx(scopeType, scopeId, resourceKey, payload, expectedVersion, options?.indexEntries ?? []);
    },

    async delete(
      scopeType: StorageScopeType,
      scopeId: string,
      resourceKey: string,
      expectedVersion: ExpectedVersion
    ): Promise<SetResult<JsonObject>> {
      // The statement goes first, with no pre-read short-circuit ahead of it.
      // A short-circuit would answer "already tombstoned" on its own path,
      // leaving the zero-row branch reachable only under a real race — which
      // is how two concurrent deletes of one live row ended up reporting a
      // conflict to the loser while the sequential idempotence test passed.
      // One path means the contract is decided in one place for every caller,
      // raced or not, and the conformance suite exercises it every run.
      assertDeleteExpectedVersion(expectedVersion);
      const guard = expectedVersion === "any" ? -1 : expectedVersion;
      const marked = tombstoneTx(scopeType, scopeId, resourceKey, guard);
      // Read the retained version off the statement, not off a prior read.
      if (marked !== undefined) return { ok: true, version: marked.version };

      // Nothing matched. Re-read to tell the two reasons apart.
      const current = readRow(scopeType, scopeId, resourceKey);
      // Nothing live to remove — absent, or already a tombstone (whether it was
      // tombstoned an hour ago or by the delete that just beat us). The
      // requested terminal state holds, so this is an idempotent success. No
      // tombstone is minted for a key that never existed: there is no observer
      // to fence.
      if (current === undefined) return { ok: true, version: 0 };
      if (current.lifecycle !== "live") return { ok: true, version: current.version };

      // A live row, after a statement that matched nothing. What that means
      // depends on what the caller asserted, and the two cases are NOT the
      // same. `"any"` asserts nothing about versions and its `-1` guard matches
      // every one, so a zero-row UPDATE can only mean there was no live row
      // when it ran — the blind delete's own question, already answered. The
      // call linearizes there, and the row visible now was recreated between
      // the UPDATE and this read by another connection or process. Version `0`
      // rather than `current.version`, because `0` is this contract's "no live
      // row" and names no row, whereas `current.version` names the recreated
      // live row this delete never removed.
      //
      // Reachable here only across connections: `better-sqlite3` is
      // synchronous, so nothing yields between the two statements inside one
      // process and no in-process test can produce the interleaving. The
      // Postgres adapter, where the round trips are genuinely separate, carries
      // the gated test for both — this branch is kept identical to it
      // deliberately, and the shared conformance suite pins the sequential
      // halves for all four adapters.
      if (expectedVersion === "any") return { ok: true, version: 0 };

      // A positive `expectedVersion` DID assert one, and at that same
      // linearization point it did not hold. A genuine conflict, carrying the
      // version now stored so the caller can retry against it.
      return resourceStateConflict(current);
    },

    async getAll(
      scopeType: StorageScopeType,
      scopeId: string
    ): Promise<Record<string, VersionedResourceState>> {
      const rows = getAllStmt.all(scopeType, scopeId) as Array<{
        resource_key: string;
        state: string;
        version: number;
      }>;
      const result: Record<string, VersionedResourceState> = {};
      for (const row of rows) {
        result[row.resource_key] = {
          state: JSON.parse(row.state) as JsonObject,
          version: row.version
        };
      }
      return result;
    },

    async getByPrefix(
      scopeType: StorageScopeType,
      scopeId: string,
      keyPrefix: string
    ): Promise<Record<string, VersionedResourceState>> {
      const rows = getByPrefixStmt.all(
        scopeType,
        scopeId,
        keyPrefix,
        keyPrefix
      ) as Array<{ resource_key: string; state: string; version: number }>;
      const result: Record<string, VersionedResourceState> = {};
      for (const row of rows) {
        result[row.resource_key] = {
          state: JSON.parse(row.state) as JsonObject,
          version: row.version
        };
      }
      return result;
    },

    async deleteAll(scopeType: StorageScopeType, scopeId: string): Promise<void> {
      deleteAllTx(scopeType, scopeId);
    },

    async purgeTombstones(scopeType: StorageScopeType, scopeId: string): Promise<void> {
      purgeTombstonesTx(scopeType, scopeId);
    },

    indexes: {
      async state(scopeType, scopeId, collection, index): Promise<ResourceIndexBuildState> {
        const row = selectMarkerStmt.get(scopeType, scopeId, collection, index) as
          | { status: string }
          | undefined;
        if (row === undefined) return "unbuilt";
        return row.status === "built" ? "built" : "building";
      },

      async beginBuild(scopeType, scopeId, collection, index): Promise<string> {
        const build = randomUUID();
        beginBuildStmt.run(scopeType, scopeId, collection, index, build);
        return build;
      },

      async completeBuild(scopeType, scopeId, collection, index, build, entries): Promise<boolean> {
        return completeBuildTx(scopeType, scopeId, collection, index, build, entries);
      },

      async findKeys(scopeType, scopeId, collection, index, value): Promise<string[]> {
        const rows = findKeysStmt.all(scopeType, scopeId, collection, index, value) as Array<{
          resource_key: string;
        }>;
        return rows.map((row) => row.resource_key).sort();
      }
    }
  };
}

/** One (collection, index) pair as a set member. */
function markerId(collection: string, index: string): string {
  return JSON.stringify([collection, index]);
}
