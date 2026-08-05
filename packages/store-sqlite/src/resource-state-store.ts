/**
 * SQLite-backed resource state store for the SQLite adapter package.
 *
 * State — single-resource and collection-instance alike — is addressed by
 * (scope_type, scope_id, resource_key) and stored durably in the
 * `resource_state` table. SQLite has no JSONB type, so state is JSON stored as
 * TEXT: `JSON.stringify` on write, `JSON.parse` on read. Defined locally so
 * store-sqlite keeps a type-only dependency on the server package.
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
 */
import type Database from "better-sqlite3";
import type { JsonObject } from "@flow-state-dev/core/types";
import type {
  ResourceStateStore,
  ContentScopeType,
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
  // the input side. It is safe because `assertExpectedVersion` has already
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

  /** Read the row and parse it into the shape the shared contract logic takes. */
  const readRow = (
    scopeType: ContentScopeType,
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
   * Refuse an `expectedVersion` that cannot name a version.
   *
   * Mirrors `assertExpectedVersion` in the engine's
   * `stores/resource-state-predicate` module — restated for the same reason as
   * {@link conflictFrom} below, and pinned across all four adapters by the
   * shared conformance suite. `ExpectedVersion` is `number | "any"`, so a
   * caller can legally pass a number the contract has no meaning for: `0` means
   * "no live row" and real versions start at `1`. Refused loudly, because that
   * is a programming error and not a lost race — reporting it as a conflict
   * would name a concurrency outcome this store never observed.
   *
   * This is also what keeps the `-1` sentinel in `delete` sound: without it,
   * `delete(…, -1)` matched the sentinel branch and tombstoned any live row.
   */
  const assertExpectedVersion = (expectedVersion: ExpectedVersion): void => {
    if (expectedVersion === "any") return;
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      throw new TypeError(
        `expectedVersion must be a non-negative integer or "any", received ${String(expectedVersion)}`
      );
    }
  };

  /**
   * Build the conflict result from whatever is stored right now.
   *
   * This mirrors `resourceStateConflict` in the engine's
   * `stores/resource-state-predicate` module, which is the reference for what a
   * conflict reports. It is restated rather than imported because a store
   * adapter's dependency on `@flow-state-dev/engine` is **type-only** by
   * package boundary (`scripts/validate-package-boundaries.mjs`), and that
   * module is runtime code. What is shared is `ResourceStateRow`, above: both
   * SQL adapters parse into the same shape, so the two bodies are the same
   * three lines, and the shared conformance suite pins the rule for all four
   * adapters — a semantic tweak that misses one shows up as a failing case
   * rather than as silent divergence.
   */
  const conflictFrom = (row: ResourceStateRow | undefined): SetResult<JsonObject> => {
    const isLive = row !== undefined && row.lifecycle === "live";
    return {
      ok: false,
      conflict: {
        currentValue: isLive ? row.state : undefined,
        currentVersion: row?.version ?? 0
      }
    };
  };

  return {
    async get(
      scopeType: ContentScopeType,
      scopeId: string,
      resourceKey: string
    ): Promise<VersionedResourceState | undefined> {
      const row = readRow(scopeType, scopeId, resourceKey);
      if (row === undefined || row.lifecycle !== "live") return undefined;
      return { state: row.state, version: row.version };
    },

    async set(
      scopeType: ContentScopeType,
      scopeId: string,
      resourceKey: string,
      state: JsonObject,
      expectedVersion: ExpectedVersion
    ): Promise<SetResult<JsonObject>> {
      assertExpectedVersion(expectedVersion);
      const payload = JSON.stringify(state);

      if (expectedVersion === "any") {
        const written = upsertStmt.get(scopeType, scopeId, resourceKey, payload) as {
          version: number;
        };
        return { ok: true, version: written.version };
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
          return conflictFrom(current);
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
          return conflictFrom(readRow(scopeType, scopeId, resourceKey));
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
        return conflictFrom(readRow(scopeType, scopeId, resourceKey));
      }
      return { ok: true, version: nextVersion };
    },

    async delete(
      scopeType: ContentScopeType,
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
      assertExpectedVersion(expectedVersion);
      const guard = expectedVersion === "any" ? -1 : expectedVersion;
      const marked = tombstoneIfVersionStmt.get(
        scopeType,
        scopeId,
        resourceKey,
        guard,
        guard
      ) as { version: number } | undefined;
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
      // Still live: the version guard genuinely did not match.
      return conflictFrom(current);
    },

    async getAll(
      scopeType: ContentScopeType,
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
      scopeType: ContentScopeType,
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

    async deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void> {
      deleteAllStmt.run(scopeType, scopeId);
    }
  };
}
