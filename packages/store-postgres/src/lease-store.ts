/**
 * PostgreSQL-backed lease store for durable execution (FIX-140).
 *
 * One active lease per request. Acquire is a single conditional upsert,
 * so two concurrent acquirers cannot both win. Lease ids are UUIDs, so a
 * stale holder's `release` cannot free a lease minted by another process.
 */
import { randomUUID } from "node:crypto";
import type { Lease, LeaseOptions, LeaseStore } from "@flow-state-dev/engine";
import type { QueryExecutor } from "./types";

function rowToLease(row: Record<string, unknown>): Lease {
  return {
    requestId: row.request_id as string,
    leaseId: row.lease_id as string,
    holder: row.holder as string,
    acquiredAt: Number(row.acquired_at),
    expiresAt: Number(row.expires_at)
  };
}

export function createPostgresLeaseStore(executor: QueryExecutor): LeaseStore {
  return {
    async acquire(requestId: string, options: LeaseOptions): Promise<Lease | null> {
      const now = Date.now();
      const lease: Lease = {
        requestId,
        leaseId: randomUUID(),
        holder: options.holder,
        acquiredAt: now,
        expiresAt: now + options.durationMs
      };

      // One statement decides the winner. A concurrent INSERT on the same
      // request_id waits on the first one's row, then re-checks the WHERE
      // against the committed row, so only one of them gets a row back.
      // Atomic under READ COMMITTED; no transaction needed. RETURNING is the
      // verdict: a separate read-back could see a later winner's row.
      const result = await executor.query(
        `INSERT INTO leases (request_id, lease_id, holder, acquired_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (request_id) DO UPDATE SET
           lease_id = EXCLUDED.lease_id,
           holder = EXCLUDED.holder,
           acquired_at = EXCLUDED.acquired_at,
           expires_at = EXCLUDED.expires_at
         WHERE leases.expires_at <= $6 OR leases.holder = $7
         RETURNING lease_id`,
        [lease.requestId, lease.leaseId, lease.holder, lease.acquiredAt, lease.expiresAt, now, options.holder]
      );
      return result.rows[0]?.lease_id === lease.leaseId ? lease : null;
    },

    async release(requestId: string, leaseId: string): Promise<void> {
      await executor.query(
        "DELETE FROM leases WHERE request_id = $1 AND lease_id = $2",
        [requestId, leaseId]
      );
    },

    async get(requestId: string): Promise<Lease | null> {
      const result = await executor.query(
        "SELECT request_id, lease_id, holder, acquired_at, expires_at FROM leases WHERE request_id = $1",
        [requestId]
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      const lease = rowToLease(row);
      if (lease.expiresAt <= Date.now()) {
        await executor.query("DELETE FROM leases WHERE request_id = $1", [requestId]);
        return null;
      }
      return lease;
    },

    async pruneExpired(): Promise<void> {
      await executor.query("DELETE FROM leases WHERE expires_at <= $1", [Date.now()]);
    }
  };
}
