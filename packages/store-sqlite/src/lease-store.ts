/**
 * SQLite-backed lease store for durable execution (FIX-140).
 *
 * One active lease per request. Acquire uses a transaction to atomically
 * check-and-replace. Expired leases are pruned via DELETE WHERE.
 */
import type Database from "better-sqlite3";
import type { Lease, LeaseOptions, LeaseStore } from "@flow-state-dev/server";

let leaseCounter = 0;

export function createSQLiteLeaseStore(db: Database.Database): LeaseStore {
  const getStmt = db.prepare(
    `SELECT request_id, lease_id, holder, acquired_at, expires_at
     FROM leases WHERE request_id = ?`
  );

  const upsertStmt = db.prepare(
    `INSERT INTO leases (request_id, lease_id, holder, acquired_at, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(request_id) DO UPDATE SET
       lease_id = excluded.lease_id,
       holder = excluded.holder,
       acquired_at = excluded.acquired_at,
       expires_at = excluded.expires_at`
  );

  const deleteStmt = db.prepare(
    `DELETE FROM leases WHERE request_id = ? AND lease_id = ?`
  );

  const deleteByRequestStmt = db.prepare(
    `DELETE FROM leases WHERE request_id = ?`
  );

  const pruneStmt = db.prepare(
    `DELETE FROM leases WHERE expires_at <= ?`
  );

  const acquireTx = db.transaction((requestId: string, options: LeaseOptions): Lease | null => {
    const now = Date.now();
    const row = getStmt.get(requestId) as {
      request_id: string;
      lease_id: string;
      holder: string;
      acquired_at: number;
      expires_at: number;
    } | undefined;

    if (row && row.expires_at > now && row.holder !== options.holder) {
      return null;
    }

    const lease: Lease = {
      requestId,
      leaseId: `lease_${++leaseCounter}_${now}`,
      holder: options.holder,
      acquiredAt: now,
      expiresAt: now + options.durationMs
    };

    upsertStmt.run(lease.requestId, lease.leaseId, lease.holder, lease.acquiredAt, lease.expiresAt);
    return lease;
  });

  return {
    async acquire(requestId: string, options: LeaseOptions): Promise<Lease | null> {
      return acquireTx(requestId, options);
    },

    async release(requestId: string, leaseId: string): Promise<void> {
      deleteStmt.run(requestId, leaseId);
    },

    async get(requestId: string): Promise<Lease | null> {
      const row = getStmt.get(requestId) as {
        request_id: string;
        lease_id: string;
        holder: string;
        acquired_at: number;
        expires_at: number;
      } | undefined;
      if (row === undefined) return null;
      if (row.expires_at <= Date.now()) {
        deleteByRequestStmt.run(requestId);
        return null;
      }
      return {
        requestId: row.request_id,
        leaseId: row.lease_id,
        holder: row.holder,
        acquiredAt: row.acquired_at,
        expiresAt: row.expires_at
      };
    },

    async pruneExpired(): Promise<void> {
      pruneStmt.run(Date.now());
    }
  };
}
