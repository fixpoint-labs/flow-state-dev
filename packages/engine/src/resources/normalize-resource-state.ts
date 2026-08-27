/**
 * Resource state normalization — the read-path answer to "what `JsonObject`
 * does this resource hold, given a config and a possibly-absent persisted
 * value" — plus the write-path parse that rejects a schema-invalid result
 * instead of substituting a default, and rejects a schema whose parse does not
 * settle (see {@link parseResourceWriteState}).
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
 * **Assumed: a schema's parse is a pure function of its input.** That is what
 * lets the check short-circuit when the first parse changed nothing — an
 * unchanged value is taken as its own fixed point without paying a second
 * `safeParse`, and an ordinary schema over an already-normalized value is the
 * overwhelming majority of writes. A schema that parses the same input to
 * different values on different calls is not defended against here, because it
 * is already broken past what this guard could repair: resource state is parsed
 * on the way *out* as well, so such a schema corrupts reads too, and catching it
 * at one write site would only move where the surprise surfaces.
 *
 * Returns `parsed` so call sites can use it inline. Module-private: the write
 * path reaches it only through {@link parseResourceWriteState}.
 *
 * @throws {ValidationError} (`retryable: false`) when re-parsing moves the value
 */
function assertStableResourceState(
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
  // Bound on its own so the `isJsonObject` narrowing reaches the `.find` callback
  // below — the second parse need not have produced an object at all.
  const reparsedObject =
    reparsed.success && isJsonObject(reparsed.data) ? reparsed.data : undefined;
  if (reparsedObject !== undefined && deepEqual(reparsedObject, parsed)) {
    return parsed;
  }

  // Three ways the second parse can fail the fixed-point test, and each sends the
  // schema's author to a different line of their schema — so say which happened
  // rather than always claiming a field moved.
  let at = "";
  let cause =
    "the schema does not parse its own output back to the same value, so every write would " +
    "move the stored state.";

  if (reparsedObject !== undefined) {
    // A different object: name the first field that moved.
    const movedKey = Object.keys(parsed).find(
      (key) => !deepEqual(reparsedObject[key], parsed[key])
    );
    if (movedKey !== undefined && movedKey.length > 0) at = ` at "${movedKey}"`;
  } else if (reparsed.success) {
    // A non-object — a conditional transform that collapses its own output, as in
    // `{phase:0} -> {phase:1} -> null`. Nothing moved, so there is no field to
    // name, and the row would not survive its own read path either.
    const produced =
      reparsed.data === null
        ? "null"
        : Array.isArray(reparsed.data)
          ? "an array"
          : `a ${typeof reparsed.data}`;
    cause =
      `re-parsing its own output produced ${produced}, not an object, so the stored state ` +
      `would not survive its own read path.`;
  } else {
    // A rejected re-parse: a type-changing transform (`z.string().transform(Number)`)
    // whose output no longer satisfies its own input type. Name the path Zod flagged.
    const issuePath = reparsed.error.issues[0]?.path.join(".");
    if (issuePath !== undefined && issuePath.length > 0) at = ` at "${issuePath}"`;
  }

  throw new ValidationError(
    `Resource "${resourceLabel}" write failed stateSchema validation${at}: ${cause} ` +
      `Make the transform idempotent — parsing an already-parsed value must yield that ` +
      `same value.`
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
 * as — and that `{}` is held to the same stability bar, because it is what the
 * next read parses. A schema-valid string or other non-object still throws.
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
    // `{}` is what lands in the store and what the next read parses, so `{}` —
    // not the `null` this parse produced — is the value that has to be a fixed
    // point. Checking the null instead would let a schema that sends its input
    // to null seed a row here that every later mutation verb refuses: without
    // this, `create(key, seed)` succeeds while a bare `create(key)` (which
    // seeds from `{}` and so lands above) is refused — the same verb reaching
    // the same row and answering two different ways.
    //
    // Only the object case, deliberately. When `{}` fails the schema or parses
    // to a non-object there is no seed either, but that is a separate and older
    // defect with a different failure mode — the write reports success and
    // stores nothing, rather than being refused — which predates this guard and
    // is filed on its own. Widening the condition here would quietly fold that
    // fix into this one; it stays narrow until that issue lands.
    const cleared = stateSchema.safeParse({});
    if (cleared.success && isJsonObject(cleared.data)) {
      assertStableResourceState(stateSchema, cleared.data, {}, resourceLabel);
    }
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
