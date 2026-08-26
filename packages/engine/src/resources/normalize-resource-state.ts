/**
 * Resource state normalization — the read-path answer to "what `JsonObject`
 * does this resource hold, given a config and a possibly-absent persisted
 * value" — plus the write-path parse that rejects a schema-invalid result
 * instead of substituting a default.
 *
 * Lives in its own module so both `context/resource-registry` and
 * `routes/route-utils` can import it without creating a cycle, the same
 * arrangement `resources/storage-keys` uses.
 */
import type { JsonObject, ResourceConfig } from "@flow-state-dev/core/types";
import { cloneValue } from "@flow-state-dev/core/helpers";
import { ValidationError } from "../errors/flow-error";
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
 *
 * Read path only. A write whose result fails the schema must go through
 * {@link parseResourceWriteState}, which throws instead of substituting a
 * default (that substitution is what wipes fields the caller never touched).
 */
export function normalizeResourceState(config: ResourceConfig, value: unknown): JsonObject {
  const parsed = config.stateSchema.safeParse(value);
  if (parsed.success && isJsonObject(parsed.data)) {
    return parsed.data;
  }

  return normalizeResourceDefault(config);
}

/**
 * Parse a write result against `stateSchema`. Throws {@link ValidationError}
 * (`retryable: false`) when the result fails the schema or parses to a
 * non-null non-object, so the CAS mutator never persists a replacement default.
 *
 * Schema-valid `null` is the documented reset for a `.nullable()` resource
 * (`setState(null)`). The store holds `JsonObject`, so that write persists as
 * `{}` — the same cleared form an unwritten nullable single already surfaces
 * as. A schema-valid string or other non-object still throws.
 *
 * `resourceLabel` is the storage key (or accessor) named in the error.
 */
export function parseResourceWriteState(
  stateSchema: ResourceConfig["stateSchema"],
  value: unknown,
  resourceLabel: string
): JsonObject {
  const parsed = stateSchema.safeParse(value);
  if (parsed.success && isJsonObject(parsed.data)) {
    return parsed.data;
  }

  // Cleared nullable: schema accepted null. Persist the store's empty object,
  // not a default that would look like surviving data.
  if (parsed.success && parsed.data == null) {
    return {};
  }

  const issue = parsed.success ? undefined : parsed.error.issues[0];
  const issuePath = issue === undefined ? "" : issue.path.join(".");
  const issueMessage =
    issue === undefined
      ? parsed.success
        ? "parsed value is not a JSON object"
        : "schema validation failed"
      : issue.message;
  const pathSuffix = issuePath.length > 0 ? ` at "${issuePath}"` : "";
  throw new ValidationError(
    `Resource "${resourceLabel}" write failed stateSchema validation${pathSuffix}: ${issueMessage}`
  );
}
