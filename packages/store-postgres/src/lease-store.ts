/**
 * PostgreSQL-backed lease store for durable execution (FIX-140).
 *
 * One active lease per request. Acquire uses a transaction (when the
 * executor supports it) or a serializable upsert for atomicity.
 */
import type { Lease, LeaseOptions, LeaseStore } from "@flow-state-dev/engine";
import type { QueryExecutor } from "./types";

let leaseCounter = 0;

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
        leaseId: `lease_${++leaseCounter}_${now}`,
        holder: options.holder,
        acquiredAt: now,
        expiresAt: now + options.durationMs
      };

      if (executor.beginTx) {
        const tx = await executor.beginTx();
        try {
          const existing = await tx.query(
            "SELECT lease_id, holder, acquired_at, expires_at FROM leases WHERE request_id = $1 FOR UPDATE",
            [requestId]
          );
          const row = existing.rows[0];
          if (row && Number(row.expires_at) > now && row.holder !== options.holder) {
            await tx.rollback();
            return null;
          }

          await tx.query(
            `INSERT INTO leases (request_id, lease_id, holder, acquired_at, expires_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (request_id) DO UPDATE SET
               lease_id = EXCLUDED.lease_id,
               holder = EXCLUDED.holder,
               acquired_at = EXCLUDED.acquired_at,
               expires_at = EXCLUDED.expires_at`,
            [lease.requestId, lease.leaseId, lease.holder, lease.acquiredAt, lease.expiresAt]
          );
          await tx.commit();
          return lease;
        } catch (err) {
          await tx.rollback();
          throw err;
        }
      }

      // Fallback for executors without transaction support (e.g. PGlite):
      // Use a conditional upsert that only overwrites expired leases, then
      // verify we actually won by reading back the row.
      await executor.query(
        `INSERT INTO leases (request_id, lease_id, holder, acquired_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (request_id) DO UPDATE SET
           lease_id = EXCLUDED.lease_id,
           holder = EXCLUDED.holder,
           acquired_at = EXCLUDED.acquired_at,
           expires_at = EXCLUDED.expires_at
         WHERE leases.expires_at <= $6 OR leases.holder = $7`,
        [lease.requestId, lease.leaseId, lease.holder, lease.acquiredAt, lease.expiresAt, now, options.holder]
      );

      // Verify we won the race by checking if our lease_id is the one stored.
      const verify = await executor.query(
        "SELECT lease_id FROM leases WHERE request_id = $1",
        [requestId]
      );
      if (verify.rows[0]?.lease_id !== lease.leaseId) {
        return null;
      }
      return lease;
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
