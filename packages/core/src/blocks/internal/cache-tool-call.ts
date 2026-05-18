/**
 * Tool-call memoization wrapping (FIX-610 Wave 1).
 *
 * `wrapToolExecuteWithCache` composes around the original
 * `compileToolsWithExecute` `execute` closure, intercepting calls on
 * tools whose `BlockConfig.cacheable` is set. Cache hits emit a
 * `tool_output` item carrying `cached: true` (and `sourceTask` when the
 * hit crossed a task boundary). Misses run the original closure and
 * write to the cache afterward unless the call threw or `cacheIf`
 * returned false.
 *
 * The cache itself is a `Map<string, CacheEntry>` resolved per-call
 * from the active `BlockContext` via `resolveToolCacheStore`. The
 * resolution falls back gracefully when no store is installed (e.g.
 * generators used outside a Task Board with no `createToolCacheCapability`
 * in `uses`) — in that case caching is a no-op. This keeps the
 * substrate hook side-effect-free for consumers who never opted in.
 *
 * Single-flight is per-request via `ctx._toolInFlight` (top-level
 * `@internal` slot on `BlockContext`). Cross-request concurrent calls
 * each execute; last writer wins for the cache entry.
 */
import type { BlockContext, BlockCacheableConfig } from "../../types/block";

/** One cached entry. Stored in the resolved tool-cache store. */
export interface ToolCacheEntry {
  /** The tool's resolved output. Cached verbatim — consumer reads the same value the upstream produced. */
  output: unknown;
  /** Wall-clock millis (`Date.now()`) when the entry was written. */
  storedAt: number;
  /** Resolved TTL applied to this entry, in ms. `undefined` = no expiry beyond the store's default. */
  ttl?: number;
  /** Name of the tool that produced the entry — used for invalidate-by-prefix. */
  toolName: string;
  /**
   * Attribution back to the task whose original call populated this
   * entry, when the call ran inside a Task Board worker. A later
   * cache-hit emit uses this to stamp `sourceTask` on its `tool_output`
   * item.
   */
  sourceTask?: { collectionId: string; taskId: string };
}

/**
 * Store accessor surfaced by the active `BlockContext` when a cache is
 * available (Task Board with `toolCache` enabled, or a generator that
 * uses `createToolCacheCapability` directly). Returning `undefined`
 * means no cache is installed and the wrapper degrades to a no-op
 * passthrough.
 */
export interface ToolCacheStore {
  /** Default TTL applied to entries that don't specify one. */
  defaultTtl?: number;
  /** Default scope for entries that don't specify one. */
  defaultScope?: "run" | "request" | "session";
  get(key: string): ToolCacheEntry | undefined;
  set(key: string, entry: ToolCacheEntry): void;
}

/**
 * Resolution hook installed by Task Board / capability code on
 * `ctx._resolveToolCacheStore`. The wrapping module reads it lazily on
 * every call so a capability installed dynamically still takes effect
 * for any tool that runs after install.
 *
 * The accessor lives on the context as a top-level `@internal` slot so
 * it can be set without a public type-system entry point. Declared here
 * as an intersection rather than on `BlockContext` to keep the
 * substrate-only contract out of the public surface.
 */
type CtxWithCacheStore = BlockContext & {
  _resolveToolCacheStore?: () => ToolCacheStore | undefined;
  _resolveCacheSourceTask?: () => { collectionId: string; taskId: string } | undefined;
};

/**
 * Canonicalize a value into a deterministic JSON string. Recursively
 * sorts object keys so two calls whose arg objects differ only in key
 * order produce the same cache key. Throws a clear error when the value
 * contains non-JSON-serializable types (functions, symbols, BigInt,
 * class instances with custom toJSON, etc.) — silent fallback would
 * cause cache poisoning.
 *
 * `undefined` is treated as omitted (matches `JSON.stringify`). Tools
 * that distinguish "key not present" from "key present with undefined"
 * should supply their own `keyFn`.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(canonicalReplace(value));
}

function canonicalReplace(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `[tool-cache] cannot canonicalize non-finite number ${String(value)}`,
      );
    }
    return value;
  }
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
    throw new Error(
      `[tool-cache] cannot canonicalize value of type ${typeof value}; supply a custom keyFn`,
    );
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => canonicalReplace(v));
  if (value instanceof Map) {
    const entries = Array.from(value.entries())
      .map(([k, v]) => [canonicalReplace(k), canonicalReplace(v)] as const)
      .sort((a, b) => (JSON.stringify(a[0]) < JSON.stringify(b[0]) ? -1 : 1));
    return { __map: entries };
  }
  if (value instanceof Set) {
    const entries = Array.from(value.values())
      .map((v) => canonicalReplace(v))
      .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    return { __set: entries };
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const proto = Object.getPrototypeOf(obj);
    if (proto !== null && proto !== Object.prototype) {
      throw new Error(
        `[tool-cache] cannot canonicalize class instance of ${
          (proto.constructor as { name?: string } | null)?.name ?? "<anonymous>"
        }; supply a custom keyFn`,
      );
    }
    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj).sort();
    for (const k of keys) {
      const v = canonicalReplace(obj[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return value;
}

/** Build the cache key for a tool call. */
export function buildCacheKey(
  toolName: string,
  args: unknown,
  ctx: BlockContext,
  cfg: BlockCacheableConfig,
  store: ToolCacheStore,
): string {
  const scope = cfg.scope ?? store.defaultScope ?? "run";
  const scopeId = resolveScopeId(scope, ctx);
  const argsKey = cfg.keyFn !== undefined ? cfg.keyFn(args, ctx) : canonicalize(args);
  return `${scope}:${scopeId}:${toolName}:${argsKey}`;
}

function resolveScopeId(
  scope: "run" | "request" | "session",
  ctx: BlockContext,
): string {
  // `run` scope is rebuilt per board run by the wiring layer that
  // installs the store; the store itself is already rebound per run.
  // The scope id here is therefore the request id — which under the
  // typical wiring is unique-per-run since the cache store is also
  // per-run. The encoding is included for legibility/debug.
  if (scope === "session") {
    const sessionId = (ctx.session as { identity?: { id?: string } } | undefined)
      ?.identity?.id;
    return sessionId ?? "unknown-session";
  }
  return ctx.request.identity.id;
}

/** True when an entry is still within its TTL window. `0` ttl never serves. */
export function isFresh(entry: ToolCacheEntry, cfg: BlockCacheableConfig, store: ToolCacheStore): boolean {
  const ttl = cfg.ttl ?? entry.ttl ?? store.defaultTtl;
  if (ttl === 0) return false;
  if (ttl === undefined) return true;
  return Date.now() - entry.storedAt < ttl;
}

/** Normalize the `cacheable` field on a block to a config object. */
export function normalizeCacheable(
  cacheable: BlockCacheableConfig | true,
): BlockCacheableConfig {
  if (cacheable === true) return {};
  if (cacheable.ttl === 0 && process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn(
      "[tool-cache] cacheable: { ttl: 0 } disables caching for this tool",
    );
  }
  return cacheable;
}

/**
 * Read the active cache store off the context, if any. Returns
 * `undefined` when no cache is installed — caller treats this as a
 * passthrough.
 */
export function resolveToolCacheStore(ctx: BlockContext): ToolCacheStore | undefined {
  return (ctx as CtxWithCacheStore)._resolveToolCacheStore?.();
}

/** Read the current task-board source-task attribution, if any. */
export function resolveCacheSourceTask(
  ctx: BlockContext,
): { collectionId: string; taskId: string } | undefined {
  return (ctx as CtxWithCacheStore)._resolveCacheSourceTask?.();
}

/**
 * Get-or-create the per-request single-flight map for cacheable tool
 * calls. Lazy init keeps the slot absent for requests that never run a
 * cacheable tool.
 */
export function getInFlightMap(ctx: BlockContext): Map<string, Promise<unknown>> {
  if (ctx._toolInFlight === undefined) {
    ctx._toolInFlight = new Map();
  }
  return ctx._toolInFlight;
}
