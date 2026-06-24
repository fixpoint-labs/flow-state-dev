/**
 * PostgreSQL-backed sequencer checkpoint store (FIX-401).
 *
 * Latest-only persistence keyed by `(request_id, block_instance_id)`.
 * Writes use `INSERT ... ON CONFLICT DO UPDATE` so each step boundary either
 * inserts the first record or overwrites the prior one in a single round
 * trip. Storage is constant per sequencer regardless of step count.
 */
import type { CheckpointStore } from "@flow-state-dev/engine";
import type { SequencerCheckpoint } from "@flow-state-dev/core/types";
import type { QueryExecutor } from "./types";

export function createPostgresCheckpointStore(executor: QueryExecutor): CheckpointStore {
  return {
    async write(checkpoint: SequencerCheckpoint): Promise<void> {
      await executor.query(
        `INSERT INTO sequencer_checkpoints
           (request_id, block_instance_id, parent_block_instance_id, step_index, version, created_at, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (request_id, block_instance_id) DO UPDATE SET
           parent_block_instance_id = EXCLUDED.parent_block_instance_id,
           step_index               = EXCLUDED.step_index,
           version                  = EXCLUDED.version,
           created_at               = EXCLUDED.created_at,
           data                     = EXCLUDED.data`,
        [
          checkpoint.requestId,
          checkpoint.blockInstanceId,
          checkpoint.parentBlockInstanceId,
          checkpoint.stepIndex,
          checkpoint.version,
          checkpoint.createdAt,
          JSON.stringify(checkpoint)
        ]
      );
    },

    async latest(requestId: string, blockInstanceId: string): Promise<SequencerCheckpoint | null> {
      const result = await executor.query(
        "SELECT data FROM sequencer_checkpoints WHERE request_id = $1 AND block_instance_id = $2",
        [requestId, blockInstanceId]
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      const data = row.data;
      // pg returns JSONB as a parsed object; older drivers / TEXT columns
      // surface a string. Handle both shapes so the store stays adapter-safe.
      return typeof data === "string" ? (JSON.parse(data) as SequencerCheckpoint) : (data as SequencerCheckpoint);
    },

    async delete(requestId: string, blockInstanceId: string): Promise<void> {
      await executor.query(
        "DELETE FROM sequencer_checkpoints WHERE request_id = $1 AND block_instance_id = $2",
        [requestId, blockInstanceId]
      );
    },

    async deleteForRequest(requestId: string): Promise<void> {
      await executor.query(
        "DELETE FROM sequencer_checkpoints WHERE request_id = $1",
        [requestId]
      );
    }
  };
}
