/**
 * Resource state normalization — the single answer to "what `JsonObject` does
 * this resource hold, given a config and a possibly-absent persisted value".
 *
 * Lives in its own module so both `context/resource-registry` and
 * `routes/route-utils` can import it without creating a cycle, the same
 * arrangement `resources/storage-keys` uses.
 */
import type { JsonObject, ResourceConfig } from "@flow-state-dev/core/types";
import { cloneValue } from "@flow-state-dev/core/helpers";
import { isJsonObject } from "../utils/json-helpers";

/**
 * The state a resource starts from: its declared `default` when that is a JSON
 * object, otherwise whatever its `stateSchema` yields for `undefined` and then
 * for `{}`. Falls back to `{}` when the schema accepts neither.
 *
 * The declared default is cloned — callers mutate the result, and the config
 * object is shared across every request that reads the resource.
 */
export function normalizeResourceDefault(config: ResourceConfig): JsonObject {
  if (config.default !== undefined && isJsonObject(config.default)) {
    return cloneValue(config.default);
  }

  const parsedUndefined = config.stateSchema.safeParse(undefined);
  if (parsedUndefined.success && isJsonObject(parsedUndefined.data)) {
    return parsedUndefined.data;
  }

  const parsedEmpty = config.stateSchema.safeParse({});
  if (parsedEmpty.success && isJsonObject(parsedEmpty.data)) {
    return parsedEmpty.data;
  }

  return {};
}

/**
 * Parse a persisted value against the resource's schema, falling back to
 * {@link normalizeResourceDefault} when it does not validate. A rejected value
 * is never surfaced — a resource always reads as a valid `JsonObject`.
 */
export function normalizeResourceState(config: ResourceConfig, value: unknown): JsonObject {
  const parsed = config.stateSchema.safeParse(value);
  if (parsed.success && isJsonObject(parsed.data)) {
    return parsed.data;
  }

  return normalizeResourceDefault(config);
}
