/**
 * Errors thrown by the ctx.suspend() mechanism in durable actions.
 *
 * SuspensionError is the control-flow signal: a block throws it to suspend
 * execution; the sequencer catches it at the step boundary. It is NOT a
 * block failure — rescue handlers do not fire for SuspensionError.
 *
 * SuspensionRejectedError and SuspensionTimeoutError are thrown on resume
 * when the suspension was rejected or timed out, respectively. These ARE
 * catchable by rescue handlers.
 */

import type { SuspensionReason } from "../types/suspension";

export interface SuspendOptions {
  reason: SuspensionReason;
  message?: string;
  data?: Record<string, unknown>;
  resumeSchema?: Record<string, unknown>;
  timeoutMs?: number;
  render?: { component: string; props?: Record<string, unknown> };
}

export class SuspensionError extends Error {
  readonly suspensionId: string;
  readonly reason: SuspensionReason;
  readonly data?: Record<string, unknown>;
  readonly resumeSchema?: Record<string, unknown>;
  readonly render?: { component: string; props?: Record<string, unknown> };
  readonly timeoutMs?: number;

  constructor(options: SuspendOptions & { suspensionId: string }) {
    super(options.message ?? `Flow suspended: ${options.reason}`);
    this.name = "SuspensionError";
    this.suspensionId = options.suspensionId;
    this.reason = options.reason;
    this.data = options.data;
    this.resumeSchema = options.resumeSchema;
    this.render = options.render;
    this.timeoutMs = options.timeoutMs;
  }
}

export class SuspensionRejectedError extends Error {
  readonly suspensionId: string;
  readonly rejectedBy?: string;
  readonly rejectionData?: unknown;

  constructor(suspensionId: string, rejectedBy?: string, rejectionData?: unknown) {
    super(`Suspension ${suspensionId} was rejected`);
    this.name = "SuspensionRejectedError";
    this.suspensionId = suspensionId;
    this.rejectedBy = rejectedBy;
    this.rejectionData = rejectionData;
  }
}

export class SuspensionTimeoutError extends Error {
  readonly suspensionId: string;

  constructor(suspensionId: string) {
    super(`Suspension ${suspensionId} timed out`);
    this.name = "SuspensionTimeoutError";
    this.suspensionId = suspensionId;
  }
}
