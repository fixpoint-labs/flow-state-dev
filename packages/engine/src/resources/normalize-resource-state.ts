/**
 * Resource state normalization — the read-path answer to "what `JsonObject`
 * does this resource hold, given a config and a possibly-absent persisted
 * value" — plus the write-path parse that rejects a schema-invalid result
 * instead of substituting a default, and rejects a schema whose parse does not
 * settle (see {@link assertStableResourceState}).
 *
 * Lives in its own module so both `context/resource-registry` and
 * `routes/route-utils` can import it without creating a cycle, the same
 * arrangement `resources/storage-keys` uses.
 */
import type { JsonObject, ResourceConfig } from "@flow-state-dev/core/types";
import { cloneValue, deepEqual } from "@flow-state-dev/core/helpers";
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
 * Require a value the write path is about to store to be a **fixed point** of
 * its own schema — parsing it again must yield that same value.
 *
 * Why the write path needs this at all, since `parsed` came straight out of
 * `safeParse`: a resource's stored row is parsed on the way out as well as on
 * the way in. The read path normalizes the row into the request's cache, the
 * caller's updater builds its next value on top of that cache, and the write
 * parses the result again. So every schema step that rewrites its input runs
 * once per read-modify-write cycle. If the step is idempotent — filling a
 * default, stripping an unknown key, normalizing a retired enum value — the
 * second application is a no-op and the row converges. If it is not, the row
 * moves a little further on every cycle, the write reports success, and
 * `ref.state` reads back a plausible value because the same shift re-applies on
 * the way out.
 *
 * The check is therefore on the parse's *stability*, not on whether the parse
 * changed anything. Rejecting any change would break the normalization the read
 * path depends on (BP-030): that is exactly how a row written before its schema
 * gained a defaulted field acquires that field.
 *
 * Returns `parsed` so call sites can use it inline.
 *
 * @throws {ValidationError} (`retryable: false`) when re-parsing moves the value
 */
export function assertStableResourceState(
  stateSchema: ResourceConfig["stateSchema"],
  parsed: JsonObject,
  candidate: unknown,
  resourceLabel: string
): JsonObject {
  // The parse left the candidate alone, so it is trivially its own fixed point
  // and the second parse would only cost time. This is the common case: an
  // ordinary schema over an already-normalized value.
  if (deepEqual(candidate, parsed)) return parsed;

  const reparsed = stateSchema.safeParse(parsed);
  if (reparsed.success && isJsonObject(reparsed.data) && deepEqual(reparsed.data, parsed)) {
    return parsed;
  }

  // Name the field that moved. A type-changing transform (`z.string().transform(Number)`)
  // fails the re-parse outright rather than differing, so there may be no field to name.
  const movedKey = reparsed.success
    ? Object.keys(parsed).find(
        (key) => !deepEqual((reparsed.data as JsonObject)[key], parsed[key])
      )
    : reparsed.error.issues[0]?.path.join(".");
  const at = movedKey === undefined || movedKey.length === 0 ? "" : ` at "${movedKey}"`;

  throw new ValidationError(
    `Resource "${resourceLabel}" write failed stateSchema validation${at}: the schema ` +
      `does not parse its own output back to the same value, so every write would move the ` +
      `stored state. Make the transform idempotent — parsing an already-parsed value must ` +
      `yield that same value.`
  );
}

/**
 * Parse a write result against `stateSchema`. Throws {@link ValidationError}
 * (`retryable: false`) when the result fails the schema or parses to a
 * non-null non-object, so the CAS mutator never persists a replacement default.
 *
 * A successful parse is additionally held to {@link assertStableResourceState}:
 * the value about to be stored must parse back to itself, so the row cannot be
 * moved by the schema on every read-modify-write cycle.
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
    return assertStableResourceState(stateSchema, parsed.data, value, resourceLabel);
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
