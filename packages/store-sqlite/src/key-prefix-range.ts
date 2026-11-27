/**
 * The prefix read every SQLite `getByPrefix` uses: a range on `resource_key`,
 * `>= prefix AND < successor`, which the primary key
 * `(scope_type, scope_id, resource_key)` answers as an index range, so the
 * read walks only the collection's rows instead of every row in the scope.
 *
 * SQLite compares text in `BINARY` order, which for UTF-8 is code-point
 * order, the order `keyPrefixSuccessor` computes its bound in. A range
 * compare has no wildcards, so `%` and `_` in a key stay literal.
 */
import type Database from "better-sqlite3";
import { keyPrefixSuccessor } from "@flow-state-dev/core/helpers";

/** Run a prepared prefix read for one scope and prefix, returning its rows. */
export type KeyPrefixRead = (scopeType: string, scopeId: string, prefix: string) => unknown[];

/**
 * Prepare `scopedSelect` (a `SELECT … WHERE` ending in two `?` binds for
 * `scope_type` and `scope_id`) as a prefix read. Two statements, because an
 * empty prefix, or one with no successor, has no upper bound.
 */
export function prepareKeyPrefixRead(db: Database.Database, scopedSelect: string): KeyPrefixRead {
  const bounded = db.prepare(`${scopedSelect} AND resource_key >= ? AND resource_key < ?`);
  const unbounded = db.prepare(`${scopedSelect} AND resource_key >= ?`);
  return (scopeType, scopeId, prefix) => {
    const successor = keyPrefixSuccessor(prefix);
    return successor === null
      ? unbounded.all(scopeType, scopeId, prefix)
      : bounded.all(scopeType, scopeId, prefix, successor);
  };
}
