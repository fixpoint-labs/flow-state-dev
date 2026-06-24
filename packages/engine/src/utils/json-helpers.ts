/**
 * Shared JSON type guards and coercion helpers.
 */
import type { JsonObject } from "@flow-state-dev/core/types";

export function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function asJsonObject(value: unknown): JsonObject {
  if (!isJsonObject(value)) {
    return {};
  }

  return value;
}
