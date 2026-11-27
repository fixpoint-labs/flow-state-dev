// FIX-140.
/**
 * Suspension and resume types for durable execution.
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
// One entrypoint: the contracts module that defines them, which also carries
// the stored reason set and the card shape the pending read projects.
import {
  suspendForUserKindOf,
  suspensionShape,
  type ResumeAction,
  type SuspensionReason,
  type SuspensionShape,
  type SuspensionStatus,
  type SuspendForUserKind
} from "@flow-state-dev/contracts/types/suspension";
export type { ResumeAction, SuspensionReason, SuspensionShape, SuspensionStatus, SuspendForUserKind };
export { USER_SUSPENSION_REASONS, isUserSuspension, suspendForUserKindOf, suspensionShape } from "@flow-state-dev/contracts/types/suspension";

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
  // BP-030.
  /**
   * The flow instance that owns the suspended run — the address a resume must
   * re-enter it through. Two copies of one kind suspend independently, so the
   * kind alone does not say which one is waiting. Absent on a record persisted
   * before owners were recorded; guard with `== null`, falling back to
   * `flowKind`, which is the correct address for a singleton and the only one
   * such a record ever had.
   */
  flowId?: string;
  actionName: string;
  sessionId?: string;
  userId: string;

  reason: SuspensionReason;
  // FIX-2129.
  /**
   * What a user's suspension asks for, when `ctx.suspendForUser` set it.
   * Absent on a raw `ctx.suspend` and on every other
   * suspension: read it with `suspendForUserKindOf`, which falls back to the
   * reason.
   */
  kind?: SuspendForUserKind;
  // BP-030.
  /**
   * The suspension's short heading; `message` is then its body. Absent when the
   * suspension gave none, including every record persisted before it existed:
   * a reader falls back to `message`.
   */
  title?: string;
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
  "expired",
  "stopped",
  "cancelled"
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
   * the ReplayLog's `pendingSuspension()`, overwriting any supplied value; a
   * resolution without it matches no gate.
   */
  pendingBlockLogicalId?: string;
  // FIX-2129.
  /**
   * How this resume resolves the gate, when that is not the action's own
   * status; the `suspension_resume` audit item records it. Set by the server
   * at re-entry, overwriting any supplied value: the gate's recorded status (a
   * stopped ask), or `expired` when this `reject` is the engine's own
   * continuation of an approval that passed its `expiresAt` unanswered (the
   * durability sweep's re-drive, or a stop of a turn behind one). Only that
   * continuation can name an expiry, never the gate's status, which an expiry
   * write can race. With `expired`, `ctx.suspend()` throws a
   * `SuspensionRejectedError` marked `expired`. `cancelled` is
   * read from the gate's recorded status: `ctx.suspend()` throws a
   * `SuspensionRejectedError` marked `cancelled`.
   */
  resolution?: SuspensionStatus;
  /**
   * Set by the server at re-entry, overwriting any supplied value: whether the
   * suspension being resolved waits for a user (`isUserSuspension`).
   */
  userSuspension?: boolean;
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

// FIX-2770.
/**
 * One of a user's pending suspensions as the pending read answers it: what
 * an Inbox lists and its card draws, and the flow instance and session an
 * answer goes through. Never the run's payload: no `stepInput`,
 * `resumeData` or `data`, and nothing of how it resolves.
 */
export type PendingUserSuspension = {
  readonly suspensionId: string;
  readonly requestId: string;
  /** The request's flow kind. */
  readonly flowKind: string;
  /** The request's flow instance, else the suspension's; absent on a record written before instances had ids. */
  readonly flowId?: string;
  /** The request's session; absent for a sessionless request. */
  readonly sessionId?: string;
  /** What it asks for (`suspendForUserKindOf`). */
  readonly kind: SuspendForUserKind;
  /** The card it draws (`suspensionShape`). */
  readonly shape: SuspensionShape;
  readonly title?: string;
  readonly message: string;
  readonly allow?: readonly ResumeAction[];
  readonly resumeSchema?: Record<string, unknown>;
  readonly render?: { component: string; props?: Record<string, unknown> };
  readonly createdAt: number;
  readonly expiresAt?: number;
};

/**
 * Where a read of pending suspensions starts: strictly after this
 * `(createdAt, requestId, suspensionId)`. A suspension's id is unique only
 * within its request, so the request is part of the order.
 */
export type PendingUserSuspensionCursor = {
  readonly createdAt: number;
  readonly requestId: string;
  readonly suspensionId: string;
};

/**
 * The scope of a read of one user's pending suspensions. Every key is the
 * server's, never a caller's. `tenantId` and `orgId` are always present,
 * `undefined` included: an unbound principal matches only unbound requests,
 * so absence can never widen the read.
 */
export type PendingUserSuspensionQuery = {
  readonly userId: string;
  readonly tenantId: string | undefined;
  readonly orgId: string | undefined;
  /** The request's flow kind is one of these. Never empty when it reaches a store. */
  readonly flowKinds: readonly string[];
  /** The engine's clock: a suspension whose `expiresAt` is at or before it is left out. */
  readonly now: number;
  /** At most this many rows, oldest first by `(createdAt, requestId, suspensionId)`. */
  readonly limit: number;
  readonly after?: PendingUserSuspensionCursor;
};

/**
 * The fields a store selects for one pending row: the suspension's own, and
 * the request's flow and session. `null` reads as absent, as SQL hands it back.
 */
export type SelectedUserSuspension = {
  suspensionId: string;
  requestId: string;
  flowKind: string;
  flowId?: string | null;
  sessionId?: string | null;
  reason: string;
  kind?: SuspendForUserKind | null;
  title?: string | null;
  message: string;
  allow?: ResumeAction[] | null;
  resumeSchema?: Record<string, unknown> | null;
  render?: { component: string; props?: Record<string, unknown> } | null;
  createdAt: number;
  expiresAt?: number | null;
};

/**
 * Build a {@link PendingUserSuspension} field by field from what a store
 * selected, deriving `kind` and `shape`. The one projector every store uses,
 * so the four can't drift. It reads only the fields it names: a whole record
 * passed in still yields only the projection, with no payload.
 */
export function projectUserSuspension(selected: SelectedUserSuspension): PendingUserSuspension {
  const reason = selected.reason;
  const allow = selected.allow ?? undefined;
  const resumeSchema = selected.resumeSchema ?? undefined;
  return {
    suspensionId: selected.suspensionId,
    requestId: selected.requestId,
    flowKind: selected.flowKind,
    ...(selected.flowId != null ? { flowId: selected.flowId } : {}),
    ...(selected.sessionId != null ? { sessionId: selected.sessionId } : {}),
    // The read keeps only a user's suspensions, which always have a kind.
    kind: suspendForUserKindOf({ reason, kind: selected.kind ?? undefined }) ?? "approval",
    shape: suspensionShape({ reason, ...(allow !== undefined ? { allow } : {}), ...(resumeSchema !== undefined ? { resumeSchema } : {}) }),
    ...(selected.title != null ? { title: selected.title } : {}),
    message: selected.message,
    ...(allow !== undefined ? { allow } : {}),
    ...(resumeSchema !== undefined ? { resumeSchema } : {}),
    ...(selected.render != null ? { render: selected.render } : {}),
    createdAt: Number(selected.createdAt),
    ...(selected.expiresAt != null ? { expiresAt: Number(selected.expiresAt) } : {})
  };
}
