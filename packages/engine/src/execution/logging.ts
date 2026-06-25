/**
 * Runtime logging utilities for action/block execution and retry observability.
 */
import type { ExecutionMetadata } from "./types";

const DEFAULT_SUMMARY_MAX_LENGTH = 240;

export type RuntimeLoggerLevel = "debug" | "info" | "warn" | "error";

export type RuntimeLogger = {
  debug?: (message: string, context: Record<string, unknown>) => void;
  info?: (message: string, context: Record<string, unknown>) => void;
  warn?: (message: string, context: Record<string, unknown>) => void;
  error?: (message: string, context: Record<string, unknown>) => void;
};

/**
 * Console-backed runtime logger used by default for server execution traces.
 */
export const DEFAULT_RUNTIME_LOGGER: RuntimeLogger = {
  debug: (message, context) => {
    if (shouldLogToConsole()) {
      console.debug(message, context);
    }
  },
  info: (message, context) => {
    if (shouldLogToConsole()) {
      console.info(message, context);
    }
  },
  warn: (message, context) => {
    if (shouldLogToConsole()) {
      console.warn(message, context);
    }
  },
  error: (message, context) => {
    if (shouldLogToConsole()) {
      console.error(message, context);
    }
  }
};

/**
 * Emits a runtime log entry when the provided logger implements the level method.
 */
export function logRuntimeEvent(
  logger: RuntimeLogger | undefined,
  level: RuntimeLoggerLevel,
  message: string,
  context: Record<string, unknown>
): void {
  logger?.[level]?.(message, context);
}

/**
 * Produces a compact and bounded string summary for runtime inputs/outputs/errors.
 */
export function summarizeForLog(
  value: unknown,
  maxLength = DEFAULT_SUMMARY_MAX_LENGTH
): string {
  const normalized = formatForLog(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

/**
 * Converts execution metadata into a stable log-context object.
 */
export function createExecutionLogContext(
  metadata: ExecutionMetadata
): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    requestId: metadata.requestId,
    actionName: metadata.actionName,
    flowKind: metadata.flowKind,
    userId: metadata.userId,
    sessionId: metadata.sessionId,
    orgId: metadata.orgId,
    blockName: metadata.blockName,
    blockKind: metadata.blockKind,
    blockInstanceId: metadata.blockInstanceId,
    scope: metadata.scope,
    attempt: metadata.attempt,
    stepIndex: metadata.stepIndex,
    workGroupId: metadata.workGroupId
  };

  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined) {
      filtered[key] = value;
    }
  }
  return filtered;
}

function formatForLog(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }

  if (value === undefined) {
    return "undefined";
  }

  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) {
      return serialized;
    }
  } catch {
    // Ignore serialization issues and fall back to broad string coercion.
  }

  return String(value);
}


function shouldLogToConsole(): boolean {
  return process.env.NODE_ENV !== "test";
}
