/**
 * Suspension and resume types for durable execution (FIX-140).
 *
 * A suspension occurs when a block calls `ctx.suspend()` inside a durable
 * action. The sequencer catches the resulting SuspensionError, persists a
 * SuspensionRecord, and sets the request status to "suspended". An external
 * actor later resolves the suspension via the resume endpoint, which
 * re-invokes the action with a ResumeContext so the sequencer can skip
 * completed steps and continue from the suspension point.
 */

// `SuspensionStatus` and `SuspensionReason` are pure leaf types consumed by
// the item taxonomy, so their declarations live in the zero-dependency
// `@flow-state-dev/contracts` layer. Re-exported here to preserve this path's
// surface; the record/filter machinery below still references them locally.
import type { ResumeAction, SuspensionReason, SuspensionStatus } from "@flow-state-dev/contracts";
export type { ResumeAction, SuspensionReason, SuspensionStatus };

/**
 * Returned by `ctx.suspend()` when a human skips an optional suspension (resumed
 * with `action: "skip"`). Distinct from `reject`, which throws
 * `SuspensionRejectedError` and aborts the flow: a skip is normal control flow,
 * so a flow author branches on it (`if (r === SUSPENSION_SKIPPED) useDefault()`).
 * The symbol never crosses the serialization boundary — only the string
 * `resolution: "skipped"` is ever persisted; the sentinel is reconstructed on
 * both the live continuation and the replay path.
 */
export const SUSPENSION_SKIPPED: unique symbol = Symbol.for("fsd.suspension.skipped");
/** The type of the {@link SUSPENSION_SKIPPED} sentinel. */
export type SuspensionSkipped = typeof SUSPENSION_SKIPPED;

export interface SuspensionRecord {
  suspensionId: string;
  requestId: string;
  flowKind: string;
  actionName: string;
  sessionId?: string;
  userId: string;

  reason: SuspensionReason;
  message: string;
  data?: Record<string, unknown>;
  /**
   * JSON Schema describing the expected resume payload shape. Generated
   * from the Zod schema passed to ctx.suspend({ resumeSchema }). Stored
   * as JSON Schema (not a Zod instance) so suspension records are
   * serializable across processes.
   */
  resumeSchema?: Record<string, unknown>;
  render?: { component: string; props?: Record<string, unknown> };
  /**
   * The resolution actions this suspension permits. The resume route rejects an
   * inbound action outside this set (409), and renderers read it to decide which
   * controls to show (e.g. a Skip button appears iff `"skip"` is present). When
   * absent — including on records persisted before this field existed — the
   * suspension is treated as binary `["approve", "reject"]` for back-compat.
   */
  allow?: ResumeAction[];

  status: SuspensionStatus;

  blockInstanceId: string;
  stepIndex: number;
  /** The input value that was about to be passed to the step that suspended. */
  stepInput?: unknown;

  createdAt: number;
  expiresAt?: number;
  resolvedAt?: number;
  resolvedBy?: string;
  resumeData?: unknown;
}

/**
 * Suspension statuses that are past the pending phase. A suspension in any of
 * these has been resolved (or aged out) and carries a `resolvedAt`, making it
 * eligible for retention pruning. `pending` is the sole non-terminal status.
 */
export const TERMINAL_SUSPENSION_STATUSES: readonly SuspensionStatus[] = [
  "approved",
  "rejected",
  "submitted",
  "skipped",
  "timed_out",
  "expired"
];

/** True when `status` is a resolved/aged-out (non-pending) suspension status. */
export function isTerminalSuspensionStatus(status: SuspensionStatus): boolean {
  return TERMINAL_SUSPENSION_STATUSES.includes(status);
}

/**
 * The terminal status each resume action resolves a suspension to. Shared by the
 * resume route (which writes the record status) and `runAction` (which stamps
 * the `suspension_resume` audit item's `resolution`) so the two never drift.
 */
export const RESUME_ACTION_STATUS: Record<ResumeAction, SuspensionStatus> = {
  approve: "approved",
  reject: "rejected",
  submit: "submitted",
  skip: "skipped"
};

/**
 * Apply a `SuspensionFilter` to a single record. Shared by every adapter that
 * filters suspensions in JS (memory, filesystem, the SQLite list path) so the
 * `flowKind`/`userId`/`sessionId`/`status`/`createdBefore`/`resolvedBefore`
 * semantics stay identical across stores. `limit` is a result-set bound, not a
 * per-record predicate, so it is NOT applied here — callers slice after sorting.
 */
export function matchesSuspensionFilter(
  record: SuspensionRecord,
  filter?: SuspensionFilter
): boolean {
  if (filter === undefined) return true;
  if (filter.flowKind !== undefined && record.flowKind !== filter.flowKind) return false;
  if (filter.userId !== undefined && record.userId !== filter.userId) return false;
  if (filter.sessionId !== undefined && record.sessionId !== filter.sessionId) return false;
  if (filter.status !== undefined && record.status !== filter.status) return false;
  if (filter.createdBefore !== undefined && !(record.createdAt < filter.createdBefore)) {
    return false;
  }
  if (
    filter.resolvedBefore !== undefined &&
    !(record.resolvedAt !== undefined && record.resolvedAt < filter.resolvedBefore)
  ) {
    return false;
  }
  return true;
}

export interface ResumeContext {
  suspensionId: string;
  action: ResumeAction;
  data?: unknown;
  resumedBy?: string;
  /**
   * Logical block path (`${requestId}:${path}`) of the suspension being
   * resolved. `ctx.suspend()` matches on it so only the resolving gate returns
   * the resume payload (or throws on reject); every other gate reached during
   * the same replay re-suspends normally. Set by the server at re-entry from
   * the ReplayLog's `pendingSuspension()`. Absent on the legacy two-request
   * path, where `ctx.suspend()` falls back to first-gate matching (FIX-811).
   */
  pendingBlockLogicalId?: string;
}

export interface SuspensionFilter {
  flowKind?: string;
  userId?: string;
  sessionId?: string;
  status?: SuspensionStatus;
  limit?: number;
  /** Match records whose `createdAt` is strictly less than this timestamp (ms). */
  createdBefore?: number;
  /**
   * Match records that have a non-null `resolvedAt` strictly less than this
   * timestamp (ms). Records with no `resolvedAt` never match.
   */
  resolvedBefore?: number;
}
