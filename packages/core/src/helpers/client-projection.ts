/**
 * Shared helpers for resource / collection `client` field projections.
 *
 * `validateClientProjection` runs at definition time (`defineResource` /
 * `defineResourceCollection`) and enforces:
 *   1. Mutual exclusion across `expose`, `exclude`, and `data`.
 *   2. Field names listed in `expose` / `exclude` exist on the state schema
 *      (best-effort — silently skipped when the schema isn't a `ZodObject`).
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
 * (more than one of `expose`/`exclude`/`data` set) or references a field name
 * that isn't on the state schema. `definer` is included verbatim in the
 * error message so authors can grep for the location.
 *
 * `ref` is the resource ref or collection pattern — surfaced in the error
 * to disambiguate when many resources are defined in one file.
 */
export function validateClientProjection(args: {
  definer: string;
  ref: string;
  stateSchema: unknown;
  client: ProjectionClient;
}): void {
  const { definer, ref, stateSchema, client } = args;
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
