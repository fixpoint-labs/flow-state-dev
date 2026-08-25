/**
 * Shared type guard for a resource-collection config entry.
 *
 * A collection is an object with a string `pattern`. Single resources
 * expose `stateSchema` and do not carry `pattern`.
 */
import type { ResourceCollectionConfig } from "@flow-state-dev/core/types";

/** True when `value` is a collection config (has a string `pattern`). */
export function isCollectionConfig(
  value: unknown
): value is ResourceCollectionConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "pattern" in value &&
    typeof (value as ResourceCollectionConfig).pattern === "string"
  );
}
