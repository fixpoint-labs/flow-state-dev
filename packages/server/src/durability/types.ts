/**
 * DurabilityProvider interface — the coordination layer between FSD's
 * checkpoint infrastructure and the resume runtime.
 *
 * Handles HOW resume works within a run: checkpoint save/load, suspension
 * records, lease management, and skip-and-inject resume. Orthogonal to
 * FlowDispatcher (FIX-711), which handles WHERE the flow runs and crash
 * detection/re-invocation.
 */

import type { SequencerCheckpoint } from "@flow-state-dev/core/types";
import type { SuspensionFilter, SuspensionRecord } from "@flow-state-dev/core/types";

export interface DurabilityProvider {
  /** Persist a checkpoint at a sequencer step boundary. */
  saveCheckpoint(checkpoint: SequencerCheckpoint): Promise<void>;

  /** Load the latest checkpoint for a sequencer instance. */
  loadCheckpoint(
    requestId: string,
    blockInstanceId: string
  ): Promise<SequencerCheckpoint | null>;

  /** Create a suspension record when ctx.suspend() is called. */
  suspend(record: SuspensionRecord): Promise<void>;

  /** Load a specific suspension by ID. */
  loadSuspension(
    requestId: string,
    suspensionId: string
  ): Promise<SuspensionRecord | null>;

  /** List suspended requests matching a filter. */
  listSuspended(filter?: SuspensionFilter): Promise<SuspensionRecord[]>;

  /**
   * Attempt to acquire an exclusive lease for resuming a request.
   * Returns the lease on success, null if already held by another holder.
   */
  acquireLease(
    requestId: string,
    options: LeaseOptions
  ): Promise<Lease | null>;

  /** Release a previously acquired lease. */
  releaseLease(requestId: string, leaseId: string): Promise<void>;

  /**
   * Clean up durability artifacts for a completed request: suspension
   * records and leases. Called when a durable request reaches a final
   * terminal status (completed/failed). Checkpoint cleanup is controlled
   * separately via request.cleanupCheckpointsOnTerminal.
   */
  cleanup(requestId: string): Promise<void>;
}

export interface LeaseOptions {
  /** Identifier of the holder (worker id, process id). */
  holder: string;
  /** How long the lease is valid, in ms. */
  durationMs: number;
}

export interface Lease {
  requestId: string;
  leaseId: string;
  holder: string;
  acquiredAt: number;
  expiresAt: number;
}
