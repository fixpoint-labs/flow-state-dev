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
}
