/**
 * The ReplayLog — log-as-source-of-truth read model for single-request resume
 * (FIX-811).
 *
 * When a suspended or interrupted request continues under its own id, the
 * runtime must decide, for each block it re-enters, whether that block already
 * produced a committed output on a prior run (so it should be injected rather
 * than re-executed). This module builds that decision model from a request's
 * durable item log.
 *
 * The replay key is the block's stable *logical* path — `${requestId}:${path}`,
 * the attempt-independent prefix of a `blockInstanceId`. Keying on the logical
 * path (rather than a positional step index) is what lets resume tolerate code
 * changes between suspend and resume, and is the substrate the per-block replay
 * check in `executeBlock` consults via `ctx._replayLog`.
 *
 * `core` cannot depend on `server`, so the server builds the ReplayLog at
 * re-entry from the persisted items and assigns it to `ctx._replayLog`; the
 * core executor only reads this interface.
 */
import type { BlockTraceItem, BlockValueInternal } from "../../items/types";
import type { RuntimeItem } from "../../items/internal";
import { parseBlockInstanceId } from "./block-instance-id";
import { buildItemLookup, resolveBlockValueInternal } from "../../items/resolve-value";

/** A suspension that was already resolved on a prior continuation. */
export interface ResolvedResume {
  /** The payload the resolving caller passed back (`ctx.suspend()`'s return). */
  data: unknown;
  /** True when the resolution was a rejection (re-throw `SuspensionRejectedError`). */
  rejected: boolean;
  /** The original suspension id (for reconstructing a rejection error). */
  suspensionId: string;
  /** Who resolved it (for reconstructing a rejection error). */
  resolvedBy: string | undefined;
}

/**
 * Read model the resume runtime consults per logical block path. Built once at
 * re-entry by {@link buildReplayLog}.
 */
export interface ReplayLog {
  /**
   * The canonical committed output for a logical block path
   * (`${requestId}:${path}`), or `undefined` when no committed `completed`
   * trace exists for it (→ the block must execute). The returned BlockValue is
   * fully materialised to `inline` so callers never receive a `ref` into a
   * shadowed run-1 partial.
   */
  getCompletedOutput(blockLogicalId: string): BlockValueInternal<unknown> | undefined;
  /**
   * The suspension this continuation resolves: the latest `suspension` item
   * with no matching `suspension_resume`, mapped to its logical block path.
   * `undefined` when nothing is pending. Used to match `ctx.suspend()` to the
   * resolving block by logical path across N suspend/resume cycles.
   */
  pendingSuspension(): { blockLogicalId: string; suspensionId: string } | undefined;
  /**
   * The suspensions at a logical block path that were ALREADY resolved on a
   * prior continuation, in original suspend order. A `ctx.suspend()` re-reached
   * during replay that is NOT the current pending gate consults this and returns
   * the recorded resolution instead of re-suspending — so a multi-gate sequencer
   * resumed at a later gate replays the earlier (already-resolved) gates rather
   * than bouncing back to them. Empty when the gate has no prior resolution.
   * This does not depend on a `completed` block trace, so it is robust to suspend
   * blocks whose trace stays `in_progress` because they re-run on every replay.
   */
  resolvedResumes(blockLogicalId: string): readonly ResolvedResume[];
}

/** Strip the trailing `:${attempt}` from a blockInstanceId, yielding its logical id. */
function logicalIdOf(blockInstanceId: string): string | undefined {
  const parsed = parseBlockInstanceId(blockInstanceId);
  if (parsed === undefined) return undefined;
  return `${parsed.requestId}:${parsed.path}`;
}

/**
 * Build a {@link ReplayLog} from a request's durable item log.
 *
 * Canonical selection is status-based: among `block_trace` items sharing a
 * logical path, the `status === "completed"` trace with the highest `itemIndex`
 * wins. `ref`-shaped outputs are resolved against the same item set at build
 * time and stored as `inline`, so a replayed output never points at a partial
 * that the canonical view shadows.
 */
export function buildReplayLog(items: readonly RuntimeItem[]): ReplayLog {
  const lookup = buildItemLookup(items as readonly { id: string; type: string }[]);

  const completed = new Map<string, { itemIndex: number; output: BlockValueInternal<unknown> }>();
  const suspensions: Array<{ logicalId: string; suspensionId: string; itemIndex: number }> = [];
  const resumedIds = new Set<string>();
  /** Resolution payloads keyed by the suspension id they resolved. */
  const resumeBySuspension = new Map<
    string,
    { data: unknown; rejected: boolean; resolvedBy: string | undefined }
  >();

  for (const item of items) {
    if (item.type === "block_trace") {
      const trace = item as BlockTraceItem;
      if (trace.status !== "completed") continue;
      const logicalId = logicalIdOf(trace.blockInstanceId);
      if (logicalId === undefined) continue;
      const prior = completed.get(logicalId);
      if (prior !== undefined && trace.itemIndex < prior.itemIndex) continue;
      const resolved =
        trace.output === undefined
          ? undefined
          : resolveBlockValueInternal(trace.output, lookup);
      completed.set(logicalId, {
        itemIndex: trace.itemIndex,
        output: { kind: "inline", value: resolved },
      });
    } else if (item.type === "suspension") {
      const susp = item as RuntimeItem & { suspensionId: string; blockInstanceId?: string };
      // The suspension item is emitted with runtime provenance, so the
      // suspending block's identity is carried on the item's `blockInstanceId`
      // field; fall back to provenance for older/hand-built records.
      const logicalId = logicalIdOf(susp.blockInstanceId ?? item.provenance.blockInstanceId);
      if (logicalId === undefined) continue;
      suspensions.push({ logicalId, suspensionId: susp.suspensionId, itemIndex: item.itemIndex });
    } else if (item.type === "suspension_resume") {
      const resume = item as RuntimeItem & {
        suspensionId: string;
        resolution?: string;
        resumeData?: unknown;
        resolvedBy?: string;
      };
      resumedIds.add(resume.suspensionId);
      resumeBySuspension.set(resume.suspensionId, {
        data: resume.resumeData,
        rejected: resume.resolution === "rejected",
        resolvedBy: resume.resolvedBy,
      });
    }
  }

  // The pending suspension is the latest (highest itemIndex) `suspension`
  // whose id has no `suspension_resume`. Sort once at build time.
  let pending: { blockLogicalId: string; suspensionId: string } | undefined;
  let pendingIndex = -1;
  for (const s of suspensions) {
    if (resumedIds.has(s.suspensionId)) continue;
    if (s.itemIndex >= pendingIndex) {
      pendingIndex = s.itemIndex;
      pending = { blockLogicalId: s.logicalId, suspensionId: s.suspensionId };
    }
  }

  // Already-resolved suspensions, grouped by logical path in original suspend
  // order (the `suspension` item index), with their recorded resolution. A
  // gate re-reached during replay that is not the pending target replays these
  // in order rather than re-suspending.
  const resolvedByLogical = new Map<string, ResolvedResume[]>();
  const orderedSuspensions = [...suspensions].sort((a, b) => a.itemIndex - b.itemIndex);
  for (const s of orderedSuspensions) {
    const resume = resumeBySuspension.get(s.suspensionId);
    if (resume === undefined) continue; // unresolved (the pending gate) — skip
    const list = resolvedByLogical.get(s.logicalId) ?? [];
    list.push({
      data: resume.data,
      rejected: resume.rejected,
      suspensionId: s.suspensionId,
      resolvedBy: resume.resolvedBy,
    });
    resolvedByLogical.set(s.logicalId, list);
  }

  const noResolved: readonly ResolvedResume[] = [];
  return {
    getCompletedOutput: (blockLogicalId) => completed.get(blockLogicalId)?.output,
    pendingSuspension: () => pending,
    resolvedResumes: (blockLogicalId) => resolvedByLogical.get(blockLogicalId) ?? noResolved,
  };
}
