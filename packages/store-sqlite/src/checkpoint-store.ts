/**
 * SQLite-backed sequencer checkpoint store (FIX-401).
 *
 * Latest-only persistence: identity is the composite key
 * `(request_id, block_instance_id)`. Writes use `INSERT ... ON CONFLICT DO
 * UPDATE` so a step boundary either inserts the first record or overwrites
 * the prior one in a single statement. Storage is constant per sequencer
 * regardless of step count.
 */
import type Database from "better-sqlite3";
import type { CheckpointStore } from "@flow-state-dev/server";
import type { SequencerCheckpoint } from "@flow-state-dev/core/types";

type CheckpointRow = {
  request_id: string;
  block_instance_id: string;
  parent_block_instance_id: string | null;
  step_index: number;
  version: number;
  created_at: number;
  data: string;
};

export function createSQLiteCheckpointStore(db: Database.Database): CheckpointStore {
  const upsertStmt = db.prepare(
    `INSERT INTO sequencer_checkpoints
       (request_id, block_instance_id, parent_block_instance_id, step_index, version, created_at, data)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(request_id, block_instance_id) DO UPDATE SET
       parent_block_instance_id = excluded.parent_block_instance_id,
       step_index = excluded.step_index,
       version = excluded.version,
       created_at = excluded.created_at,
       data = excluded.data`
  );
  const getStmt = db.prepare(
    `SELECT data FROM sequencer_checkpoints WHERE request_id = ? AND block_instance_id = ?`
  );
  const deleteStmt = db.prepare(
    `DELETE FROM sequencer_checkpoints WHERE request_id = ? AND block_instance_id = ?`
  );
  const deleteForRequestStmt = db.prepare(
    `DELETE FROM sequencer_checkpoints WHERE request_id = ?`
  );

  return {
    async write(checkpoint: SequencerCheckpoint): Promise<void> {
      upsertStmt.run(
        checkpoint.requestId,
        checkpoint.blockInstanceId,
        checkpoint.parentBlockInstanceId,
        checkpoint.stepIndex,
        checkpoint.version,
        checkpoint.createdAt,
        JSON.stringify(checkpoint)
      );
    },

    async latest(requestId: string, blockInstanceId: string): Promise<SequencerCheckpoint | null> {
      const row = getStmt.get(requestId, blockInstanceId) as { data: string } | undefined;
      if (row === undefined) return null;
      return JSON.parse(row.data) as SequencerCheckpoint;
    },

    async delete(requestId: string, blockInstanceId: string): Promise<void> {
      deleteStmt.run(requestId, blockInstanceId);
    },

    async deleteForRequest(requestId: string): Promise<void> {
      deleteForRequestStmt.run(requestId);
    }
  };
}

export type { CheckpointRow };
