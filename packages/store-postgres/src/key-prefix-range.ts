/**
 * The predicate every Postgres prefix read uses: a byte-order range on
 * `resource_key`, which `idx_resource_state_key` and `idx_resource_content_key`
 * (`(scope_type, scope_id, resource_key COLLATE "C")`) answer as an index
 * range, so the read walks only the collection's rows instead of every row
 * in the scope.
 *
 * The compare names `COLLATE "C"` because a prefix's successor bounds its
 * keys only in byte order; in a language collation, keys under one prefix
 * need not sort together. The column, the primary key and every
 * `ORDER BY resource_key` keep the database's collation.
 */
import { keyPrefixSuccessor } from "@flow-state-dev/core/helpers";

/** A SQL fragment and the positional values it binds. */
export type KeyPrefixRange = { sql: string; values: string[] };

/**
 * The range `resource_key COLLATE "C" >= prefix [AND < successor]`, binding
 * from `$<firstParam>`. An empty prefix, or one with no successor, has no
 * upper bound.
 */
export function keyPrefixRange(prefix: string, firstParam: number): KeyPrefixRange {
  const lower = `resource_key COLLATE "C" >= $${firstParam}`;
  const successor = keyPrefixSuccessor(prefix);
  if (successor === null) return { sql: lower, values: [prefix] };
  return {
    sql: `${lower} AND resource_key COLLATE "C" < $${firstParam + 1}`,
    values: [prefix, successor]
  };
}
