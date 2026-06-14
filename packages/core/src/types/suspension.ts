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

export type SuspensionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "timed_out"
  | "expired";

export type SuspensionReason =
  | "human_approval"
  | "human_input"
  | "external_event"
  | "tool_approval"
  | (string & {});

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

  /**
   * Server-internal state the suspended block needs to resume without
   * re-executing completed work. Never included in the `SuspensionItem`
   * emitted to clients (it may carry large or sensitive payloads). For
   * tool-approval suspensions (FIX-275) this carries the serialized model
   * turn — the compiled request messages plus the assistant tool-call /
   * sibling-result messages — so a resumed generator continues the turn
   * without replaying the LLM call. Deleted with the record on cleanup.
   */
  resumeState?: Record<string, unknown>;
}

/**
 * Suspension statuses that are past the pending phase. A suspension in any of
 * these has been resolved (or aged out) and carries a `resolvedAt`, making it
 * eligible for retention pruning. `pending` is the sole non-terminal status.
 */
export const TERMINAL_SUSPENSION_STATUSES: readonly SuspensionStatus[] = [
  "approved",
  "rejected",
  "timed_out",
  "expired"
];

/** True when `status` is a resolved/aged-out (non-pending) suspension status. */
export function isTerminalSuspensionStatus(status: SuspensionStatus): boolean {
  return TERMINAL_SUSPENSION_STATUSES.includes(status);
}

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
  action: "approve" | "reject";
  data?: unknown;
  resumedBy?: string;
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
