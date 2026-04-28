/**
 * In-memory sequencer checkpoint store (FIX-401).
 *
 * Latest-only semantics: identity is `(requestId, blockInstanceId)`. Each
 * `write` overwrites the prior record. Suitable for tests and single-process
 * deployments where checkpoints don't need to survive a restart.
 */
import type { SequencerCheckpoint } from "@flow-state-dev/core/types";
import type { CheckpointStore } from "../types";

export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly data = new Map<string, SequencerCheckpoint>();

  private key(requestId: string, blockInstanceId: string): string {
    return `${requestId}:${blockInstanceId}`;
  }

  async write(checkpoint: SequencerCheckpoint): Promise<void> {
    this.data.set(this.key(checkpoint.requestId, checkpoint.blockInstanceId), checkpoint);
  }

  async latest(requestId: string, blockInstanceId: string): Promise<SequencerCheckpoint | null> {
    return this.data.get(this.key(requestId, blockInstanceId)) ?? null;
  }

  async delete(requestId: string, blockInstanceId: string): Promise<void> {
    this.data.delete(this.key(requestId, blockInstanceId));
  }
}

export function createInMemoryCheckpointStore(): CheckpointStore {
  return new InMemoryCheckpointStore();
}
