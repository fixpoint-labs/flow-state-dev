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

import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { SuspensionReason } from "../types/suspension";

export interface SuspendOptions {
  reason: SuspensionReason;
  message?: string;
  data?: Record<string, unknown>;
  /**
   * Shape of the payload the resolver supplies on resume. Pass a Zod schema
   * (the framework's schema language) or a pre-built JSON Schema object; either
   * is normalized to a plain, serializable JSON Schema for storage and DevTool
   * rendering. A raw Zod instance must never reach the stores — it carries
   * functions that fail structured-clone and JSON serialization.
   */
  resumeSchema?: ZodTypeAny | Record<string, unknown>;
  timeoutMs?: number;
  render?: { component: string; props?: Record<string, unknown> };
}

/**
 * Normalize a `resumeSchema` to a plain JSON Schema. Detects a Zod schema by
 * its `safeParse` method and converts it; a value that is already a plain
 * object (or undefined) passes through unchanged.
 */
function normalizeResumeSchema(
  schema: ZodTypeAny | Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (schema === undefined || schema === null) return undefined;
  if (typeof (schema as { safeParse?: unknown }).safeParse === "function") {
    return zodToJsonSchema(schema as ZodTypeAny) as Record<string, unknown>;
  }
  return schema as Record<string, unknown>;
}

export class SuspensionError extends Error {
  readonly suspensionId: string;
  readonly reason: SuspensionReason;
  readonly data?: Record<string, unknown>;
  readonly resumeSchema?: Record<string, unknown>;
  readonly render?: { component: string; props?: Record<string, unknown> };
  readonly timeoutMs?: number;

  /** @internal Stamped by the sequencer so runAction can build a SuspensionRecord. */
  _stepIndex?: number;
  /** @internal The currentValue at the point of suspension (input for the suspended step). */
  _currentValue?: unknown;
  /** @internal Snapshot of sequencer state at the point of suspension. */
  _sequencerState?: Record<string, unknown>;

  constructor(options: SuspendOptions & { suspensionId: string }) {
    super(options.message ?? `Flow suspended: ${options.reason}`);
    this.name = "SuspensionError";
    this.suspensionId = options.suspensionId;
    this.reason = options.reason;
    this.data = options.data;
    this.resumeSchema = normalizeResumeSchema(options.resumeSchema);
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
