/**
 * Cached-fetch — freshness-bounded, identity-addressed read-through cache over
 * resource collections.
 *
 * This module gives fetched/computed data a declared, persisted home with a
 * time-based freshness bound — the third thing FSD's two existing caches don't
 * cover (the tool cache is input-addressed and in-run; plain collections are
 * identity-addressed and persisted but have no notion of staleness).
 *
 * Three layers, smallest surface first:
 *
 *   - `createCachedFetchCapability(options)` — the primary surface. Declares the
 *     cache collection in its own `resources` slot (auto-installed into every
 *     block that lists it in `uses`) and exposes a `CachedFetchAccessor` at
 *     `ctx.cap.<name>`. Blocks opt in with `uses: [cap]` and call
 *     `ctx.cap.cache.getOrFetch(...)` / `getOrCompute(...)` — no ref threading.
 *     The accessor sees scope identity, so it adds tenant-safe cross-request
 *     single-flight (`processDedup`).
 *   - `cachedCollection(options)` — definition-time sugar over
 *     `defineResourceCollection`: wraps a value schema in the cache envelope and
 *     applies the bounded/unbounded prefetch + eviction defaults. For consumers
 *     that want explicit collection control (typed domain collections).
 *   - `getOrCompute(ref, key, fetcher, options)` / `invalidateCached(ref, ...)` —
 *     the ref-first substrate the two layers above are built on.
 *
 * Freshness is evaluated app-side from a `storedAt` timestamp in the persisted
 * envelope, never delegated to the store — so it works on any store backend and
 * a shortened `staleAfter` takes effect immediately on existing entries. Expiry
 * is lazy: stale entries persist until overwritten by a refetch or count-evicted
 * by the collection's eviction policy.
 */
import { z } from "zod";
import {
  canonicalizeToolArgs,
  defineCapability,
  defineResourceCollection,
  parseDuration,
} from "@flow-state-dev/core";
import type {
  BlockContext,
  DefinedCapability,
  DefinedResourceCollection,
  JsonValue,
  ResourceCollectionConfig,
  ResourceCollectionRef,
} from "@flow-state-dev/core";

// ---------------------------------------------------------------------------
// Envelope + value schema
// ---------------------------------------------------------------------------

/**
 * Persisted shape of a cached instance: the value plus its write timestamp.
 * Declared as a type alias (not an interface) so it satisfies the collection's
 * `JsonObject` state constraint — interfaces lack an implicit index signature.
 */
export type CacheEnvelope<TValue extends JsonValue = JsonValue> = {
  value: TValue;
  /** Epoch ms at write time. Freshness is computed from this on read. */
  storedAt: number;
};

/**
 * Recursive JSON-value schema for free-form cached payloads. Use this (not
 * `z.unknown()`) as the default `valueSchema` so the envelope's state schema
 * stays a concrete `JsonObject`. `z.record`/`z.union` are fine here — BP-016
 * strictness applies only to generator output schemas, not resource state.
 */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

// ---------------------------------------------------------------------------
// Runtime — getOrCompute / invalidateCached (ref-first substrate)
// ---------------------------------------------------------------------------

/** Options for a single `getOrCompute` call. */
export interface GetOrComputeOptions {
  /** Freshness window (`"15m"`, `"120s"`, or raw ms). `0` = always refetch. */
  staleAfter: number | string;
  /**
   * Grace window after staleness: on fetcher failure, serve the stale entry
   * while its total age is under `staleAfter + staleIfError`. `true` = serve
   * stale of any age (default). `false` = never serve stale on error; rethrow.
   */
  staleIfError?: number | string | boolean;
  /** Test seam; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Per-request single-flight map, keyed by the runtime collection ref. Ref
 * identity is stable for the life of a request, so this dedupes concurrent
 * same-key calls within one run (parallel fan-out) without risking cross-tenant
 * promise sharing — a global map keyed by the ref's pattern/uri would collide
 * across scope instances, the ref object would not.
 */
const pendingByRef = new WeakMap<object, Map<string, Promise<unknown>>>();

function pendingFor(ref: object): Map<string, Promise<unknown>> {
  let map = pendingByRef.get(ref);
  if (map === undefined) {
    map = new Map();
    pendingByRef.set(ref, map);
  }
  return map;
}

/**
 * Structural check that stored state is a cache envelope. The resource registry
 * returns persisted state unvalidated, so a malformed/drifted record must be
 * treated as a miss rather than trusted.
 */
function isEnvelope(state: unknown): state is CacheEnvelope {
  return (
    typeof state === "object" &&
    state !== null &&
    typeof (state as { storedAt?: unknown }).storedAt === "number" &&
    "value" in (state as object)
  );
}

/** Decide whether a stale entry may be served after a fetcher failure. */
function mayServeStaleOnError(
  ageMs: number,
  staleAfterMs: number,
  staleIfError: number | string | boolean | undefined,
): boolean {
  const policy = staleIfError ?? true;
  if (policy === false) return false;
  if (policy === true) return true;
  return ageMs < staleAfterMs + parseDuration(policy);
}

/**
 * Read-through get-or-compute over a cache collection ref.
 *
 * Returns the cached value when a valid envelope is fresher than `staleAfter`.
 * Otherwise runs `fetcher`, persists `{ value, storedAt }`, and returns the new
 * value. Concurrent same-key calls in one request share a single fetch. On
 * fetcher failure, a stale entry within the `staleIfError` grace window is
 * served; otherwise the original error is rethrown.
 */
export async function getOrCompute<TValue extends JsonValue>(
  ref: ResourceCollectionRef<CacheEnvelope<TValue>>,
  key: string,
  fetcher: () => Promise<TValue>,
  options: GetOrComputeOptions,
): Promise<TValue> {
  const now = options.now ?? Date.now;
  const staleAfterMs = parseDuration(options.staleAfter);

  const existing = await ref.getOptional(key);
  const envelope =
    existing !== undefined && isEnvelope(existing.state) ? existing.state : undefined;

  if (envelope !== undefined && now() - envelope.storedAt < staleAfterMs) {
    return envelope.value as TValue;
  }

  const pending = pendingFor(ref);
  const inflight = pending.get(key);
  if (inflight !== undefined) return inflight as Promise<TValue>;

  const run = (async (): Promise<TValue> => {
    try {
      const value = await fetcher();
      await ref.upsert(key, { value, storedAt: now() } as Partial<CacheEnvelope<TValue>>);
      return value;
    } catch (err) {
      if (
        envelope !== undefined &&
        mayServeStaleOnError(now() - envelope.storedAt, staleAfterMs, options.staleIfError)
      ) {
        return envelope.value as TValue;
      }
      throw err;
    }
  })();

  pending.set(key, run);
  try {
    return await run;
  } finally {
    pending.delete(key);
  }
}

/**
 * Delete cached instances by exact key or key prefix. Returns the number of
 * instances removed. Prefix semantics: an exact key matches its own instance;
 * a prefix matches every instance under it.
 */
export async function invalidateCached(
  ref: ResourceCollectionRef<CacheEnvelope<JsonValue>>,
  keyOrPrefix: string,
): Promise<number> {
  const matches = await ref.list(keyOrPrefix);
  for (const instance of matches) {
    await ref.delete(instance.path);
  }
  return matches.length;
}

// ---------------------------------------------------------------------------
// Definition-time — cachedCollection
// ---------------------------------------------------------------------------

/** Options for `cachedCollection`. */
export interface CachedCollectionOptions<TValue extends z.ZodType<JsonValue>> {
  /** Glob pattern, e.g. `"cache/**"`. */
  pattern: string;
  scope: "session" | "user" | "org";
  flowIsolation?: boolean;
  /**
   * Schema for the cached value. Must produce JSON-safe values. For free-form
   * payloads use `jsonValueSchema`, not `z.unknown()`.
   */
  valueSchema: TValue;
  /**
   * Cardinality bound. NOTE: eviction requires eager prefetch
   * (`defineResourceCollection` throws on lazy + eviction), and eager
   * collections bulk-load the whole prefix per request. Bounded + eager suits
   * many small entries; for large payloads prefer unbounded + lazy.
   */
  maxInstances?: number;
  /** Defaults to `"lru"` when `maxInstances` is set, else `"none"`. */
  eviction?: "lru" | "oldest";
  /** Defaults to `"eager"` when `maxInstances` is set (eviction needs it), else `"lazy"`. */
  prefetchMode?: "eager" | "lazy";
  client?: ResourceCollectionConfig["client"];
}

/**
 * Sugar over `defineResourceCollection`: wraps `valueSchema` in the cache
 * envelope (`{ value, storedAt }`) and applies the bounded/unbounded defaults.
 * Passing `maxInstances` with an explicit `prefetchMode: "lazy"` surfaces
 * `defineResourceCollection`'s own error (eviction cannot see a partial cache).
 */
export function cachedCollection<TValue extends z.ZodType<JsonValue>>(
  options: CachedCollectionOptions<TValue>,
): DefinedResourceCollection<CacheEnvelope<z.infer<TValue>>> {
  const stateSchema = z.object({
    value: options.valueSchema,
    storedAt: z.number(),
  });
  const eviction =
    options.eviction ?? (options.maxInstances !== undefined ? "lru" : "none");
  const prefetchMode =
    options.prefetchMode ?? (options.maxInstances !== undefined ? "eager" : "lazy");

  return defineResourceCollection({
    pattern: options.pattern,
    scope: options.scope,
    ...(options.flowIsolation !== undefined ? { flowIsolation: options.flowIsolation } : {}),
    stateSchema,
    ...(options.maxInstances !== undefined ? { maxInstances: options.maxInstances } : {}),
    eviction,
    prefetchMode,
    ...(options.client !== undefined ? { client: options.client } : {}),
  }) as unknown as DefinedResourceCollection<CacheEnvelope<z.infer<TValue>>>;
}

// ---------------------------------------------------------------------------
// Capability — createCachedFetchCapability (primary surface)
// ---------------------------------------------------------------------------

/**
 * Surface exposed at `ctx.cap.<name>` by `createCachedFetchCapability`.
 * Declared as a type alias (not an interface) so it satisfies the capability
 * `fns` return constraint (`Record<string, (...args) => any>`).
 */
export type CachedFetchAccessor = {
  /** Identity-addressed read-through get-or-compute. */
  getOrCompute<T extends JsonValue>(
    key: string,
    fetcher: () => Promise<T>,
    overrides?: Partial<GetOrComputeOptions>,
  ): Promise<T>;
  /** Input-addressed sugar: key = `${tool}/${canonicalizeToolArgs(args)}`. */
  getOrFetch<T extends JsonValue>(
    tool: string,
    args: unknown,
    fetcher: () => Promise<T>,
    overrides?: Partial<GetOrComputeOptions>,
  ): Promise<T>;
  /** Delete by exact key or prefix. Returns count deleted. */
  invalidate(keyOrPrefix: string): Promise<number>;
};

/** Options for `createCachedFetchCapability`. */
export interface CreateCachedFetchCapabilityOptions {
  /** Accessor name on `ctx.cap` and internal resource-key seed. Default `"cache"`. */
  name?: string;
  /** Collection pattern. Default `"cache/**"`. */
  pattern?: string;
  /** Resource scope. Default `"user"`. */
  scope?: "session" | "user" | "org";
  /** Default `false` — share the cache across flows of the same scope owner. */
  flowIsolation?: boolean;
  /** Default `jsonValueSchema` (free-form JSON payloads). */
  valueSchema?: z.ZodType<JsonValue>;
  maxInstances?: number;
  eviction?: "lru" | "oldest";
  prefetchMode?: "eager" | "lazy";
  client?: ResourceCollectionConfig["client"];
  /** Default freshness window bound into the accessor (overridable per call). */
  staleAfter: number | string;
  /** Default `true` (serve any-age stale on fetcher failure). */
  staleIfError?: number | string | boolean;
  /**
   * Process-level single-flight across requests, keyed by
   * `${scope}:${scopeId}:${key}` (tenant-safe — different scope ids never share
   * a flight). Preserves "concurrent runs share one upstream fetch". Default `true`.
   */
  processDedup?: boolean;
}

/** Derive the scope-instance id used to key cross-request dedup. */
function deriveScopeId(scope: "session" | "user" | "org", ctx: BlockContext): string {
  const identity = (ctx.session as { identity?: { id?: string; userId?: string; orgId?: string } } | undefined)
    ?.identity;
  if (scope === "org") return identity?.orgId ?? "unknown-org";
  if (scope === "user") return identity?.userId ?? "unknown-user";
  return identity?.id ?? "unknown-session";
}

/**
 * Build a configured cached-fetch capability. The returned capability declares
 * its cache collection in `resources` (auto-installed into every block that
 * `uses` it) and exposes a `CachedFetchAccessor` at `ctx.cap.<name>` with
 * `staleAfter`/`staleIfError` bound and cross-request dedup applied.
 */
export function createCachedFetchCapability(
  options: CreateCachedFetchCapabilityOptions,
): DefinedCapability {
  const name = options.name ?? "cache";
  const scope = options.scope ?? "user";
  const resourceKey = `${name}Store`;
  const defaultStaleAfter = options.staleAfter;
  const defaultStaleIfError = options.staleIfError ?? true;
  const processDedup = options.processDedup ?? true;

  const collection = cachedCollection({
    pattern: options.pattern ?? "cache/**",
    scope,
    flowIsolation: options.flowIsolation ?? false,
    valueSchema: options.valueSchema ?? jsonValueSchema,
    maxInstances: options.maxInstances,
    eviction: options.eviction,
    prefetchMode: options.prefetchMode,
    client: options.client,
  });

  // Shared across every fns(ctx) for this capability instance — the cross-request
  // single-flight scope. Keyed by scope id so tenants never share a flight.
  const processPending = new Map<string, Promise<unknown>>();

  return defineCapability({
    name,
    resources: { [resourceKey]: collection },
    fns: (ctx: BlockContext): CachedFetchAccessor => {
      const ref = (ctx as { resources: Record<string, unknown> }).resources[
        resourceKey
      ] as ResourceCollectionRef<CacheEnvelope>;
      const scopeId = deriveScopeId(scope, ctx);

      const resolveOptions = (
        overrides: Partial<GetOrComputeOptions> | undefined,
      ): GetOrComputeOptions => ({
        staleAfter: overrides?.staleAfter ?? defaultStaleAfter,
        staleIfError: overrides?.staleIfError ?? defaultStaleIfError,
        now: overrides?.now,
      });

      const withDedup = <T>(key: string, run: () => Promise<T>): Promise<T> => {
        if (!processDedup) return run();
        const dedupKey = `${scope}:${scopeId}:${key}`;
        const inflight = processPending.get(dedupKey);
        if (inflight !== undefined) return inflight as Promise<T>;
        const promise = run().finally(() => processPending.delete(dedupKey));
        processPending.set(dedupKey, promise);
        return promise;
      };

      const getOrComputeFn = <T extends JsonValue>(
        key: string,
        fetcher: () => Promise<T>,
        overrides?: Partial<GetOrComputeOptions>,
      ): Promise<T> =>
        withDedup(key, () =>
          getOrCompute(
            ref as ResourceCollectionRef<CacheEnvelope<T>>,
            key,
            fetcher,
            resolveOptions(overrides),
          ),
        );

      return {
        getOrCompute: getOrComputeFn,
        getOrFetch: (tool, args, fetcher, overrides) =>
          getOrComputeFn(`${tool}/${canonicalizeToolArgs(args)}`, fetcher, overrides),
        invalidate: (keyOrPrefix) =>
          invalidateCached(ref as ResourceCollectionRef<CacheEnvelope<JsonValue>>, keyOrPrefix),
      };
    },
  }) as DefinedCapability;
}
