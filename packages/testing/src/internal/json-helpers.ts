/**
 * Shared coercion helpers for the testing harness. Not on the public
 * `@flow-state-dev/testing` index — `testFlow` / `testBlock` /
 * `createTestContext` were keeping three copies of the same contract.
 */
import type { JsonObject, JsonValue } from "@flow-state-dev/core/types";

/** Narrow an unknown value to a plain object. Arrays, null, and primitives become `{}`. */
export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

/** Copy a record into a `JsonObject` without validating nested values. */
export function toJsonObject(value: Record<string, unknown>): JsonObject {
  const out: JsonObject = {};

  for (const [key, entry] of Object.entries(value)) {
    out[key] = entry as JsonValue;
  }

  return out;
}

/** Map each entry through `asRecord` + `toJsonObject`. */
export function toJsonObjectRecord(
  value: Record<string, unknown>
): Record<string, JsonObject> {
  const out: Record<string, JsonObject> = {};

  for (const [key, entry] of Object.entries(value)) {
    out[key] = toJsonObject(asRecord(entry));
  }

  return out;
}

/** Unique-enough id for isolated test requests and sessions. */
export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
