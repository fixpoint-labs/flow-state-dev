/**
 * Shared helpers for resource / collection `client` field projections.
 *
 * `validateClientProjection` runs at definition time (`defineResource` /
 * `defineResourceCollection`) and enforces:
 *   1. Mutual exclusion across `expose`, `exclude`, and `data`.
 *   2. Field names listed in `expose` / `exclude` exist on the state schema
 *      (best-effort — silently skipped when the schema isn't a `ZodObject`).
 *   3. `secret` fields exist on the state schema and are not in `expose`.
 *
 * `omitSecretFields` strips a config's `secret` fields from raw state, for the
 * debug reads that return it. `resolveClientData` is the client view every
 * other engine read sends: the projection run on the full state, with any
 * `secret` field dropped from what it returns.
 *
 * `resolveClientProjection` runs at request time (server routes) and produces
 * the `clientData` payload from a resource/collection-item state. The four
 * branches (identity, expose, exclude, data) correspond to the four shapes
 * a user can declare on `client`.
 */
import type { JsonObject, JsonValue } from "../schema/common";
import type { CollectionClientConfig, ResourceClientConfig } from "../types/resource";
// NOTE: This module is imported by `types/resource.ts` and
// `types/resource-collection.ts` for the runtime `validateClientProjection`
// call. The `ResourceClientConfig` / `CollectionClientConfig` imports above
// must remain type-only to avoid a runtime cycle.
import { introspectStateKeys } from "./zod-introspect";

type ProjectionClient =
  | (Pick<ResourceClientConfig, "expose" | "exclude" | "data"> & Record<string, unknown>)
  | undefined;

/**
 * Type-level mirror of `resolveClientProjection`'s runtime branches (FIX-741).
 * Derives the client-visible shape from a resource/collection `client` config:
 *
 *   - `data`    → the (awaited) return type of the projection fn
 *   - `expose`  → `Pick<TState, listed keys>`
 *   - `exclude` → `Omit<TState, listed keys>`
 *   - none      → `TState` (identity default, including `client: undefined`)
 *
 * Mutual exclusion of `expose`/`exclude`/`data` is enforced at runtime by
 * `validateClientProjection`, so the ordered conditional is sound. Pure type —
 * the runtime contract stays `JsonValue`.
 */
export type ProjectedClient<TState extends JsonObject, TClient> =
  TClient extends { data: (state: any) => infer R }
    ? Awaited<R>
    : TClient extends { expose: ReadonlyArray<infer K extends keyof TState> }
      ? Pick<TState, K>
      : TClient extends { exclude: ReadonlyArray<infer K extends keyof TState> }
        ? Omit<TState, K>
        : TState;

/**
 * Throws at definition time when the `client` projection config is ambiguous
 * (more than one of `expose`/`exclude`/`data` set), references a field name
 * that isn't on the state schema, or sets `live` on a resource whose
 * `clientData` isn't client-visible. `definer` is included verbatim in the
 * error message so authors can grep for the location.
 *
 * `ref` is the resource ref or collection pattern — surfaced in the error
 * to disambiguate when many resources are defined in one file. `kind`
 * selects the `live` visibility gate: a collection ships per-item `clientData`
 * under `state.read: true` (or a projection); a single resource ships it only
 * under a projection (no `state.read` gate exists for singles).
 */
export function validateClientProjection(args: {
  definer: string;
  ref: string;
  kind: "single" | "collection";
  stateSchema: unknown;
  client: ProjectionClient;
  secret?: ReadonlyArray<string>;
}): void {
  const { definer, ref, kind, stateSchema, client, secret } = args;
  if (secret !== undefined) validateSecretFields(definer, ref, stateSchema, client, secret);
  if (client === undefined) return;

  const set: string[] = [];
  if (client.expose !== undefined) set.push("expose");
  if (client.exclude !== undefined) set.push("exclude");
  if (typeof client.data === "function") set.push("data");

  if (set.length > 1) {
    throw new Error(
      `${definer} for "${ref}": client config may set at most one of ` +
      `\`expose\`, \`exclude\`, or \`data\`. Got: ${set.join(", ")}.`
    );
  }

  // `live` streams the projected `clientData`, so it requires that clientData
  // ship at all. The gate mirrors the snapshot builder: collections gate
  // per-item state on `state.read`; single resources gate on a projection.
  if (client.live === true) {
    const hasProjection = set.length === 1;
    const stateRead = (client.state as { read?: boolean } | undefined)?.read === true;
    const visible = kind === "collection" ? stateRead || hasProjection : hasProjection;
    if (!visible) {
      throw new Error(
        `${definer} for "${ref}": client.live requires the resource's clientData to be ` +
        (kind === "collection"
          ? "client-visible (set `client.state.read: true` or a projection)."
          : "projected (set `expose`, `exclude`, or `data`).")
      );
    }
  }

  const fields = client.expose ?? client.exclude;
  if (fields === undefined) return;

  const knownKeys = introspectStateKeys(stateSchema);
  if (knownKeys === undefined) return;

  const unknown = fields.filter((n) => !knownKeys.has(n));
  if (unknown.length === 0) return;

  const valid = [...knownKeys].sort().join(", ") || "(none)";
  const which = client.expose !== undefined ? "expose" : "exclude";
  throw new Error(
    `${definer} for "${ref}": client.${which} names key(s) not on stateSchema: ` +
    `${unknown.join(", ")}. Valid keys: ${valid}.`
  );
}

/**
 * A `secret` field must be on the state schema (best-effort, as for `expose`)
 * and must not be one `client.expose` asks to send: the two contradict, and
 * which wins would be a guess.
 */
function validateSecretFields(
  definer: string,
  ref: string,
  stateSchema: unknown,
  client: ProjectionClient,
  secret: ReadonlyArray<string>
): void {
  const knownKeys = introspectStateKeys(stateSchema);
  const unknown = knownKeys === undefined ? [] : secret.filter((n) => !knownKeys.has(n));
  if (unknown.length > 0) {
    const valid = [...knownKeys!].sort().join(", ") || "(none)";
    throw new Error(
      `${definer} for "${ref}": secret names key(s) not on stateSchema: ` +
      `${unknown.join(", ")}. Valid keys: ${valid}.`
    );
  }
  const exposed = (client?.expose as ReadonlyArray<string> | undefined)?.filter((n) => secret.includes(n)) ?? [];
  if (exposed.length > 0) {
    throw new Error(
      `${definer} for "${ref}": client.expose names secret key(s): ${exposed.join(", ")}. ` +
      `A secret field never leaves the server; remove it from one list.`
    );
  }
}

/**
 * `state` without the fields `config.secret` names — what every read that
 * leaves the server starts from. Returns `state` itself when nothing is
 * secret, so the common path allocates nothing.
 */
export function omitSecretFields<T extends JsonObject>(
  config: { secret?: ReadonlyArray<string> },
  state: T
): JsonObject {
  const secret = config.secret;
  if (secret === undefined || secret.length === 0) return state;
  return omit(state, secret);
}

/**
 * The client view of `state`: `config.client`'s projection run on the full
 * state, then any `secret` field dropped from the result's top level. A
 * `client.data` function sees the whole state (its parameter type says so) and
 * can derive from a secret, as in `hasKey: s.value !== ""`; it cannot pass one
 * through under its own name. Every engine read that sends a projection to a
 * client goes through here.
 */
export function resolveClientData<TState extends JsonObject>(
  config: {
    client?: ResourceClientConfig<TState> | CollectionClientConfig<TState>;
    secret?: ReadonlyArray<string>;
  },
  state: TState
): JsonValue | Promise<JsonValue> {
  const projected = resolveClientProjection(config.client, state);
  return projected instanceof Promise
    ? projected.then((value) => withoutSecrets(config, value))
    : withoutSecrets(config, projected);
}

function withoutSecrets(config: { secret?: ReadonlyArray<string> }, value: JsonValue): JsonValue {
  const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
  return isObject ? omitSecretFields(config, value as JsonObject) : value;
}

function pick<T extends JsonObject>(state: T, keys: ReadonlyArray<string>): JsonObject {
  const out: JsonObject = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(state, key)) {
      out[key] = state[key];
    }
  }
  return out;
}

function omit<T extends JsonObject>(state: T, keys: ReadonlyArray<string>): JsonObject {
  const skip = new Set(keys);
  const out: JsonObject = {};
  for (const key of Object.keys(state)) {
    if (skip.has(key)) continue;
    out[key] = state[key];
  }
  return out;
}

/**
 * Resolves the `clientData` payload for a resource or collection item.
 *
 *   - `client === undefined` → identity (raw state). Server call sites are
 *     responsible for gating on `client.state.read` / `clientData` presence
 *     before calling.
 *   - `client.data` function → invoked with state. May return a Promise.
 *   - `client.expose` → pick the listed keys.
 *   - `client.exclude` → all keys except the listed ones.
 *   - otherwise → identity (raw state). This is the default and removes the
 *     historical silent-empty `{ topic }` footgun.
 */
export function resolveClientProjection<TState extends JsonObject>(
  client: ResourceClientConfig<TState> | CollectionClientConfig<TState> | undefined,
  state: TState
): JsonValue | Promise<JsonValue> {
  if (client === undefined) return state;
  if (typeof client.data === "function") return client.data(state);
  if (client.expose !== undefined) return pick(state, client.expose as ReadonlyArray<string>);
  if (client.exclude !== undefined) return omit(state, client.exclude as ReadonlyArray<string>);
  return state;
}

/**
 * True when the client config declares an explicit projection
 * (`data` / `expose` / `exclude`), as opposed to falling back to identity.
 * Used by the debug snapshot and route snapshot builders to distinguish
 * "developer-defined view" from "raw state passthrough".
 */
export function hasClientProjection(
  client:
    | ResourceClientConfig<JsonObject>
    | CollectionClientConfig<JsonObject>
    | undefined
): boolean {
  if (client === undefined) return false;
  return (
    typeof client.data === "function" ||
    Array.isArray(client.expose) ||
    Array.isArray(client.exclude)
  );
}
