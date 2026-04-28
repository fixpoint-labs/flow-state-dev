/**
 * Durable sequencer checkpoint record (FIX-401).
 *
 * Latest-only persistence: identity is `(requestId, blockInstanceId)`. Each
 * step boundary overwrites the prior record with the new state and an
 * incremented `version`. The Phase 2 resume runtime (FIX-141) reads the
 * latest checkpoint to pick up where an interrupted request left off.
 *
 * No `stepHistory` field. The optional `persistFullHistory` mode is a
 * Wave 2+ extension (out of scope for FIX-401).
 */
export interface SequencerCheckpoint {
  /** Request whose execution produced this checkpoint. */
  requestId: string;
  /** Deterministic block instance id (FIX-398). Stable across retries/resumes. */
  blockInstanceId: string;
  /** Parent sequencer's instance id when this is a nested sequencer; `null` at the root. */
  parentBlockInstanceId: string | null;
  /** 0-indexed step that produced this state. `-1` denotes the initial pre-execution snapshot. */
  stepIndex: number;
  /** Sequencer state at this boundary; validated against the sequencer's `stateSchema` at write time. */
  state: unknown;
  /** Monotonic write counter, incremented on each overwrite for the same `(requestId, blockInstanceId)`. */
  version: number;
  /** Wall-clock timestamp at write time. */
  createdAt: number;
}
