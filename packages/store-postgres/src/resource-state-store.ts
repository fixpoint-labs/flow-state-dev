/**
 * PostgreSQL-backed resource state store.
 *
 * Stores resource state (single-resource and collection-instance alike)
 * addressed by (scope_type, scope_id, resource_key). State is stored as JSONB
 * in a dedicated `resource_state` table, parallel to `resource_content` and
 * separate from the scope record JSONB.
 *
 * Concurrency is compare-and-swap, not last-write-wins: each row carries a
 * monotonic `version` and a `lifecycle`, deletes tombstone rather than remove,
 * and tombstones are retained. See `ResourceStateStore` for the semantics all
 * four adapters share.
 *
 * The CAS is a single conditional statement — the write predicates on the
 * current version and lifecycle in its `WHERE` clause, so the compare and the
 * swap are one atomic operation under the row lock. `rowCount === 0` means the
 * predicate did not match, which is the conflict signal; the current row is
 * then re-read to report it.
 *
 * The guards that refuse a version a verb cannot act on, and the conflict a
 * losing write reports, are the shared rule from `@flow-state-dev/core/helpers`.
 * The compare inside each write statement is this store's own statement of the
 * same rule, kept in step by the shared conformance suite.
 *
 * The store keeps index entries (`indexes`) in `resource_index` and build
 * markers in `resource_index_built`. Each write's index upkeep rides the
 * write's own statement as data-modifying CTEs gated on the write having
 * landed, so a row and its entries commit together or not at all, with no
 * transaction and on any executor. The rule is on `ResourceStateIndexes`.
 */

import { randomUUID } from "node:crypto";
import {
  assertDeleteExpectedVersion,
  assertSetExpectedVersion,
  resourceStateConflict
} from "@flow-state-dev/core/helpers";
import type { JsonObject } from "@flow-state-dev/core/types";
import type {
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
import type { QueryExecutor } from "./types";
import { collectionKeyRegex } from "./collection-key-regex";

/** A row as Postgres hands it back, before coercion and lifecycle narrowing. */
type RawRow = { state: JsonObject; version: number | string; lifecycle: string };

/**
 * The CTEs that keep the index in step with a write. Each is gated on
 * `source`, the CTE holding the rows the write landed, so a write that
 * conflicts changes nothing. Reads the eight parameters {@link upkeepParams}
 * returns, from `$base` on. In order: drop the key's entries the write does
 * not list, add the ones it does (a build may have added some already), and
 * clear the markers of indexes that cover the key and that it does not list.
 *
 * All CTEs of one statement share a snapshot, which is why the drop spares
 * the listed entries instead of deleting all and re-inserting: the insert
 * would not see the delete and would collide with the rows it removes.
 */
function indexUpkeep(source: string, base: number): string {
  const [scopeType, scopeId, key, collections, indexes, values, listedCollections, listedIndexes] =
    Array.from({ length: 8 }, (_, i) => `$${base + i}`);
  const landed = `EXISTS (SELECT 1 FROM ${source})`;
  const listedEntries = `unnest(${collections}::text[], ${indexes}::text[], ${values}::text[]) AS n(c, i, v)`;
  return `fsd_entries_dropped AS (
     DELETE FROM resource_index r
      WHERE ${landed}
        AND r.scope_type = ${scopeType}::text AND r.scope_id = ${scopeId}::text
        AND r.resource_key = ${key}::text
        AND NOT EXISTS (SELECT 1 FROM ${listedEntries}
                         WHERE n.c = r.collection AND n.i = r.index_name AND n.v = r.value)
   ),
   fsd_entries_added AS (
     INSERT INTO resource_index (scope_type, scope_id, collection, index_name, value, resource_key)
     SELECT ${scopeType}::text, ${scopeId}::text, n.c, n.i, n.v, ${key}::text FROM ${listedEntries}
      WHERE ${landed}
     ON CONFLICT DO NOTHING
   ),
   fsd_markers_cleared AS (
     DELETE FROM resource_index_built b
      WHERE ${landed}
        AND b.scope_type = ${scopeType}::text AND b.scope_id = ${scopeId}::text
        AND ${key}::text ~ b.key_regex
        AND NOT EXISTS (SELECT 1 FROM unnest(${listedCollections}::text[], ${listedIndexes}::text[]) AS l(c, i)
                         WHERE l.c = b.collection AND l.i = b.index_name)
   )`;
}

/** The parameters {@link indexUpkeep} reads, for a write of `key` listing `entries`. */
function upkeepParams(
  scopeType: StorageScopeType,
  scopeId: string,
  key: string,
  entries: ResourceIndexEntry[]
): unknown[] {
  const collections: string[] = [];
  const indexes: string[] = [];
  const values: string[] = [];
  for (const entry of entries) {
    for (const value of new Set(entry.values)) {
      collections.push(entry.collection);
      indexes.push(entry.index);
      values.push(value);
    }
  }
  return [
    scopeType,
    scopeId,
    key,
    collections,
    indexes,
    values,
    entries.map((entry) => entry.collection),
    entries.map((entry) => entry.index)
  ];
}

export function createPostgresResourceStateStore(executor: QueryExecutor): ResourceStateStore {
  /** Parse one raw result row into the shape the shared contract logic takes. */
  const parseRow = (row: RawRow): ResourceStateRow => ({
    state: row.state,
    // node-pg returns BIGINT as a string, so coerce rather than letting a
    // string version silently fail every `===` comparison downstream.
    version: Number(row.version),
    lifecycle: row.lifecycle === "live" ? "live" : "deleted"
  });

  /** Read the row and parse it into the shape the shared contract logic takes. */
  const readRow = async (
    scopeType: StorageScopeType,
    scopeId: string,
    resourceKey: string
  ): Promise<ResourceStateRow | undefined> => {
    const result = await executor.query(
      "SELECT state, version, lifecycle FROM resource_state " +
        "WHERE scope_type = $1 AND scope_id = $2 AND resource_key = $3",
      [scopeType, scopeId, resourceKey]
    );
    const row = result.rows[0] as RawRow | undefined;
    return row === undefined ? undefined : parseRow(row);
  };

  return {
    async get(
      scopeType: StorageScopeType,
      scopeId: string,
      resourceKey: string
    ): Promise<VersionedResourceState | undefined> {
      const row = await readRow(scopeType, scopeId, resourceKey);
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
      const upkeep = upkeepParams(scopeType, scopeId, resourceKey, options?.indexEntries ?? []);

      if (expectedVersion === "any") {
        // The bump happens IN the statement, not from a prior read: a
        // read-then-write here is not atomic, and two concurrent `"any"`
        // writers would both compute the same next version and both commit it.
        // The loser would then hold a version naming the winner's row, and its
        // next CAS write would sail through and clobber it — the exact lost
        // update this store exists to stop, on the one path every caller uses
        // until the registry driver lands.
        const written = await executor.query(
          `WITH w AS (
             INSERT INTO resource_state (scope_type, scope_id, resource_key, state, version, lifecycle)
             VALUES ($1, $2, $3, $4::jsonb, 1, 'live')
             ON CONFLICT (scope_type, scope_id, resource_key) DO UPDATE SET
               state = EXCLUDED.state,
               version = resource_state.version + 1,
               lifecycle = 'live'
             RETURNING version
           ),
           ${indexUpkeep("w", 5)}
           SELECT version FROM w`,
          [scopeType, scopeId, resourceKey, payload, ...upkeep]
        );
        return { ok: true, version: Number(written.rows[0]!.version) };
      }

      if (expectedVersion === "absent") {
        // "No row at all" is the insert, and nothing else: the PK arbitrates,
        // and `DO NOTHING` turns any existing row — live OR tombstoned — into
        // zero rows. That is the whole difference from the `0` branch below,
        // which goes on to revive a tombstone. Deliberately one statement: a
        // read-then-insert would let a delete land in between and put the
        // write back on the resurrection path this exists to close.
        //
        // The conflicting row comes back from the SAME statement, because a
        // separate read afterwards is a time-of-check/time-of-use split: an
        // explicit `create()` at `0` can revive the key in between, and the
        // read would then describe a LIVE row where a tombstone did the
        // refusing. `runResourceCAS` reads a conflict carrying a current value
        // as retryable, so it would re-run the mutator and apply it to the
        // recreated generation instead of throwing `ResourceDeletedError` —
        // the write landing on a delete, which is the whole thing `"absent"`
        // exists to stop.
        const attempt = await executor.query(
          `WITH ins AS (
             INSERT INTO resource_state (scope_type, scope_id, resource_key, state, version, lifecycle)
             VALUES ($1, $2, $3, $4::jsonb, 1, 'live')
             ON CONFLICT (scope_type, scope_id, resource_key) DO NOTHING
             RETURNING version, state, lifecycle
           ),
           ${indexUpkeep("ins", 5)}
           SELECT version, state, lifecycle, true AS inserted FROM ins
           UNION ALL
           SELECT version, state, lifecycle, false AS inserted
             FROM resource_state
            WHERE scope_type = $1 AND scope_id = $2 AND resource_key = $3
              AND NOT EXISTS (SELECT 1 FROM ins)`,
          [scopeType, scopeId, resourceKey, payload, ...upkeep]
        );
        const attempted = attempt.rows[0] as (RawRow & { inserted: boolean }) | undefined;
        if (attempted === undefined) {
          // No arm produced a row, which happens in exactly one case: the
          // conflicting row was committed by another transaction AFTER this
          // statement's snapshot, so the unique index refused the insert while
          // the `UNION` arm — reading under that snapshot — could not see it.
          // That is a racing first insert, not the revive above: a tombstone
          // old enough to refuse us predates the snapshot and is visible to
          // both arms. Nothing atomic is available here, so re-read.
          return resourceStateConflict(await readRow(scopeType, scopeId, resourceKey));
        }
        if (attempted.inserted) return { ok: true, version: 1 };
        return resourceStateConflict(parseRow(attempted));
      }

      if (expectedVersion === 0) {
        // No row at all: a plain insert at version 1. `DO NOTHING` makes a lost
        // race report zero rows rather than overwriting the winner.
        const inserted = await executor.query(
          `WITH w AS (
             INSERT INTO resource_state (scope_type, scope_id, resource_key, state, version, lifecycle)
             VALUES ($1, $2, $3, $4::jsonb, 1, 'live')
             ON CONFLICT (scope_type, scope_id, resource_key) DO NOTHING
             RETURNING version
           ),
           ${indexUpkeep("w", 5)}
           SELECT version FROM w`,
          [scopeType, scopeId, resourceKey, payload, ...upkeep]
        );
        if (inserted.rows.length > 0) return { ok: true, version: 1 };

        // A row exists. Recreating over a tombstone continues from its version,
        // so a version is never reused; a live row is a conflict.
        const current = await readRow(scopeType, scopeId, resourceKey);
        if (current === undefined || current.lifecycle === "live") {
          return resourceStateConflict(current);
        }
        const nextVersion = current.version + 1;
        // Fence on the tombstone version this call actually observed. Without
        // it the predicate says only "still not live", so a revive that raced
        // another revive-plus-delete would write a version the other
        // generation already used — reusing a version is precisely what the
        // retained tombstone exists to prevent.
        const revived = await executor.query(
          `WITH w AS (
             UPDATE resource_state SET state = $1::jsonb, version = $2, lifecycle = 'live'
             WHERE scope_type = $3 AND scope_id = $4 AND resource_key = $5
               AND lifecycle <> 'live' AND version = $6
             RETURNING version
           ),
           ${indexUpkeep("w", 7)}
           SELECT version FROM w`,
          [payload, nextVersion, scopeType, scopeId, resourceKey, current.version, ...upkeep]
        );
        if (revived.rows.length === 0) {
          return resourceStateConflict(await readRow(scopeType, scopeId, resourceKey));
        }
        return { ok: true, version: nextVersion };
      }

      const nextVersion = expectedVersion + 1;
      const updated = await executor.query(
        `WITH w AS (
           UPDATE resource_state SET state = $1::jsonb, version = $2, lifecycle = 'live'
           WHERE scope_type = $3 AND scope_id = $4 AND resource_key = $5
             AND version = $6 AND lifecycle = 'live'
           RETURNING version
         ),
         ${indexUpkeep("w", 7)}
         SELECT version FROM w`,
        [payload, nextVersion, scopeType, scopeId, resourceKey, expectedVersion, ...upkeep]
      );
      if (updated.rows.length === 0) {
        return resourceStateConflict(await readRow(scopeType, scopeId, resourceKey));
      }
      return { ok: true, version: nextVersion };
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
      //
      // `-1` is the "any" sentinel. What makes it safe is not that a real
      // version is always >= 1 — that is a fact about the versions the store
      // produces, and the guard sits on the input side. It is safe because
      // `assertDeleteExpectedVersion` has already refused every negative, so no
      // caller-supplied value can reach the sentinel branch.
      assertDeleteExpectedVersion(expectedVersion);
      const guard = expectedVersion === "any" ? -1 : expectedVersion;
      // The tombstone's entries go in the same statement.
      const marked = await executor.query(
        `WITH w AS (
           UPDATE resource_state SET state = '{}'::jsonb, lifecycle = 'deleted'
           WHERE scope_type = $1 AND scope_id = $2 AND resource_key = $3
             AND lifecycle = 'live' AND ($4 = -1 OR version = $4)
           RETURNING version
         ),
         fsd_entries_dropped AS (
           DELETE FROM resource_index
            WHERE EXISTS (SELECT 1 FROM w)
              AND scope_type = $1 AND scope_id = $2 AND resource_key = $3
         )
         SELECT version FROM w`,
        [scopeType, scopeId, resourceKey, guard]
      );
      // Read the retained version off the statement, not off a prior read:
      // under `"any"` a concurrent writer can advance the row between the two.
      if (marked.rows.length > 0) {
        return { ok: true, version: Number(marked.rows[0]!.version) };
      }

      // Nothing matched. Re-read to tell the two reasons apart.
      const current = await readRow(scopeType, scopeId, resourceKey);
      // Nothing live to remove — absent, or already a tombstone (whether it was
      // tombstoned an hour ago or by the delete that just beat us). The
      // requested terminal state holds, so this is an idempotent success. No
      // tombstone is minted for a key that never existed: there is no observer
      // to fence.
      if (current === undefined) return { ok: true, version: 0 };
      if (current.lifecycle !== "live") return { ok: true, version: current.version };

      // A live row, after a statement that matched nothing. What that means
      // depends on what the caller asserted, and the two cases are NOT the
      // same — flattening them either way loses a real answer.
      //
      // `"any"` asserts nothing about versions, and its `-1` guard matches
      // every one of them, so a zero-row UPDATE can only mean there was no
      // live row when it ran. That is exactly the question a blind delete
      // asks, already answered: the call linearizes at the UPDATE, and the row
      // visible now was recreated after it. Reporting a conflict would name a
      // concurrency failure that did not affect this request.
      //
      // Version `0` and not `current.version`. `0` is this contract's "no live
      // row", which is what the UPDATE observed, and it is deliberately not a
      // version any row holds. `current.version` names the recreated row —
      // live, and something this delete never removed — so handing it back as
      // though it were a tombstone's retained version is the one genuinely
      // unsafe answer here: a caller could carry it forward into a write
      // against a generation it has never seen.
      if (expectedVersion === "any") return { ok: true, version: 0 };

      // A positive `expectedVersion` DID assert one, and at that same
      // linearization point the assertion did not hold — the row was live at
      // another version, or not live at all. That is a genuine conflict on its
      // own terms, whatever happened afterwards, and it carries the version
      // now stored so the caller can retry against it.
      return resourceStateConflict(current);
    },

    async getAll(
      scopeType: StorageScopeType,
      scopeId: string
    ): Promise<Record<string, VersionedResourceState>> {
      const result = await executor.query(
        "SELECT resource_key, state, version FROM resource_state " +
          "WHERE scope_type = $1 AND scope_id = $2 AND lifecycle = 'live'",
        [scopeType, scopeId]
      );
      const entries: Record<string, VersionedResourceState> = {};
      for (const row of result.rows) {
        entries[row.resource_key as string] = {
          state: row.state as JsonObject,
          version: Number(row.version)
        };
      }
      return entries;
    },

    async getByPrefix(
      scopeType: StorageScopeType,
      scopeId: string,
      keyPrefix: string
    ): Promise<Record<string, VersionedResourceState>> {
      // Prefix match via LEFT(...) = prefix rather than LIKE — sidesteps
      // LIKE wildcard escaping (`%`/`_` are legal in resource keys). An
      // empty prefix matches every key (LEFT(key, 0) = '').
      const result = await executor.query(
        "SELECT resource_key, state, version FROM resource_state " +
          "WHERE scope_type = $1 AND scope_id = $2 AND lifecycle = 'live' " +
          "AND LEFT(resource_key, char_length($3)) = $3",
        [scopeType, scopeId, keyPrefix]
      );
      const entries: Record<string, VersionedResourceState> = {};
      for (const row of result.rows) {
        entries[row.resource_key as string] = {
          state: row.state as JsonObject,
          version: Number(row.version)
        };
      }
      return entries;
    },

    async deleteAll(scopeType: StorageScopeType, scopeId: string): Promise<void> {
      // Scope purge: one bulk lifecycle mark, retaining every version. Not a
      // DELETE — the retained versions are what stop a straggler from the
      // previous generation matching a row in the next one.
      await executor.query(
        `WITH fsd_entries_dropped AS (
           DELETE FROM resource_index WHERE scope_type = $1 AND scope_id = $2
         )
         UPDATE resource_state SET state = '{}'::jsonb, lifecycle = 'deleted'
         WHERE scope_type = $1 AND scope_id = $2 AND lifecycle = 'live'`,
        [scopeType, scopeId]
      );
    },

    async purgeTombstones(scopeType: StorageScopeType, scopeId: string): Promise<void> {
      // Scope re-creation: a real DELETE of the dead rows only, so the new
      // incarnation of a reused scope id inherits no tombstone. The inverse of
      // `deleteAll` above — same scope predicate, opposite lifecycle — and
      // deliberately not reachable from teardown. See `purgeTombstones` on
      // `ResourceStateStore` for what giving those versions back costs.
      await executor.query(
        `WITH fsd_entries_dropped AS (
           DELETE FROM resource_index r USING resource_state s
            WHERE r.scope_type = $1 AND r.scope_id = $2
              AND s.scope_type = $1 AND s.scope_id = $2
              AND s.resource_key = r.resource_key AND s.lifecycle = 'deleted'
         )
         DELETE FROM resource_state
         WHERE scope_type = $1 AND scope_id = $2 AND lifecycle = 'deleted'`,
        [scopeType, scopeId]
      );
    },

    indexes: {
      async state(scopeType, scopeId, collection, index): Promise<ResourceIndexBuildState> {
        const result = await executor.query(
          `SELECT status FROM resource_index_built
            WHERE scope_type = $1 AND scope_id = $2 AND collection = $3 AND index_name = $4`,
          [scopeType, scopeId, collection, index]
        );
        const row = result.rows[0] as { status: string } | undefined;
        if (row === undefined) return "unbuilt";
        return row.status === "built" ? "built" : "building";
      },

      async beginBuild(scopeType, scopeId, collection, index): Promise<string> {
        const build = randomUUID();
        await executor.query(
          `INSERT INTO resource_index_built (scope_type, scope_id, collection, index_name, status, build_id, key_regex)
           VALUES ($1, $2, $3, $4, 'building', $5, $6)
           ON CONFLICT (scope_type, scope_id, collection, index_name)
           DO UPDATE SET status = 'building', build_id = EXCLUDED.build_id, key_regex = EXCLUDED.key_regex`,
          [scopeType, scopeId, collection, index, build, collectionKeyRegex(collection)]
        );
        return build;
      },

      async completeBuild(scopeType, scopeId, collection, index, build, entries): Promise<boolean> {
        const keys: string[] = [];
        const values: string[] = [];
        for (const entry of entries) {
          for (const value of new Set(entry.values)) {
            keys.push(entry.key);
            values.push(value);
          }
        }
        // The flip and the entries in one statement: both, only if this
        // build's marker survived the scan. Fenced on its token, so a build
        // whose marker a write cleared cannot complete on a later build's.
        const result = await executor.query(
          `WITH f AS (
             UPDATE resource_index_built SET status = 'built'
              WHERE scope_type = $1 AND scope_id = $2 AND collection = $3 AND index_name = $4
                AND status = 'building' AND build_id = $7
             RETURNING 1
           ),
           fsd_entries_added AS (
             INSERT INTO resource_index (scope_type, scope_id, collection, index_name, value, resource_key)
             SELECT $1::text, $2::text, $3::text, $4::text, n.v, n.k
               FROM unnest($5::text[], $6::text[]) AS n(k, v)
              WHERE EXISTS (SELECT 1 FROM f)
             ON CONFLICT DO NOTHING
           )
           SELECT 1 FROM f`,
          [scopeType, scopeId, collection, index, keys, values, build]
        );
        return result.rows.length > 0;
      },

      async findKeys(scopeType, scopeId, collection, index, value): Promise<string[]> {
        const result = await executor.query(
          `SELECT resource_key FROM resource_index
            WHERE scope_type = $1 AND scope_id = $2 AND collection = $3
              AND index_name = $4 AND md5(value) = md5($5::text) AND value = $5`,
          [scopeType, scopeId, collection, index, value]
        );
        return result.rows.map((row) => row.resource_key as string).sort();
      }
    }
  };
}
