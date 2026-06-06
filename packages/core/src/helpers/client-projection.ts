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
}): void {
  const { definer, ref, kind, stateSchema, client } = args;
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
