/**
 * Tool-result memoization — public surface.
 *
 * `createToolCacheCapability` returns a `DefinedCapability` that, when
 * installed on a block via `uses: [...]`, installs an in-memory cache
 * store and exposes it on the active `BlockContext` so the substrate
 * wrapping in `compileToolsWithExecute` can serve hits and write
 * misses. Bare generators benefit from the same primitive; the Task
 * Board pattern auto-installs it when `toolCache` is enabled.
 *
 * The store lives on a hidden non-enumerable bag attached to
 * `ctx.request` — NOT on `ctx.request.state` — because the runtime
 * structured-clones `state` for snapshots and the LRU store's methods
 * are functions, which would throw `DataCloneError`. The request handle
 * is shared by reference across every nested ctx, so the bag is visible
 * from any block that runs in the same request.
 *
 * The substrate wrapping at `internal/cache-tool-call.ts` imports the
 * types defined here so consumer-facing `ToolCacheStore` and the
 * substrate-internal shape stay unified.
 */
import { defineCapability } from "../capability";
import type { BlockContext } from "../types/block";

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

/** One cached tool-call entry. */
export interface ToolCacheEntry {
  /** The tool's resolved output. Cached verbatim. */
  output: unknown;
  /** Wall-clock millis (`Date.now()`) when the entry was written. */
  storedAt: number;
  /** Resolved TTL applied to this entry, in ms. `undefined` falls back to the store's default. */
  ttl?: number;
  /** Name of the tool that produced the entry — used for invalidate-by-prefix. */
  toolName: string;
  /**
   * Attribution back to the task whose original call populated this
   * entry, when the call ran inside a Task Board worker. A later
   * cache-hit emit uses this to stamp `sourceTask` on its
   * `tool_output` item.
   */
  sourceTask?: { collectionId: string; taskId: string };
}

/**
 * Store accessor surface. The substrate's `compileToolsWithExecute`
 * (in `generator.ts`) only calls `get` and `set` on the resolved store;
 * the additional `delete` / `invalidate` / `size` methods exist so
 * the capability accessor can expose invalidation and stats to
 * consumer blocks.
 */
export interface ToolCacheStore {
  defaultTtl?: number;
  defaultScope?: "run" | "request" | "session";
  get(key: string): ToolCacheEntry | undefined;
  set(key: string, entry: ToolCacheEntry): void;
  delete(key: string): void;
  invalidate(keyOrPrefix: string): number;
  size(): number;
}

// ---------------------------------------------------------------------------
// In-memory LRU
// ---------------------------------------------------------------------------

interface LruEntry {
  key: string;
  value: ToolCacheEntry;
  prev: LruEntry | undefined;
  next: LruEntry | undefined;
}

function createLruStore(opts: {
  defaultTtl?: number;
  defaultScope?: "run" | "request" | "session";
  maxEntries: number;
}): ToolCacheStore {
  const map = new Map<string, LruEntry>();
  let head: LruEntry | undefined; // most-recent
  let tail: LruEntry | undefined; // least-recent

  function detach(entry: LruEntry): void {
    if (entry.prev !== undefined) entry.prev.next = entry.next;
    if (entry.next !== undefined) entry.next.prev = entry.prev;
    if (head === entry) head = entry.next;
    if (tail === entry) tail = entry.prev;
    entry.prev = undefined;
    entry.next = undefined;
  }

  function attachHead(entry: LruEntry): void {
    entry.prev = undefined;
    entry.next = head;
    if (head !== undefined) head.prev = entry;
    head = entry;
    if (tail === undefined) tail = entry;
  }

  function evictIfNeeded(): void {
    while (map.size > opts.maxEntries && tail !== undefined) {
      const t = tail;
      detach(t);
      map.delete(t.key);
    }
  }

  return {
    defaultTtl: opts.defaultTtl,
    defaultScope: opts.defaultScope,
    get(key) {
      const e = map.get(key);
      if (e === undefined) return undefined;
      detach(e);
      attachHead(e);
      return e.value;
    },
    set(key, value) {
      const existing = map.get(key);
      if (existing !== undefined) {
        existing.value = value;
        detach(existing);
        attachHead(existing);
        return;
      }
      const entry: LruEntry = { key, value, prev: undefined, next: undefined };
      map.set(key, entry);
      attachHead(entry);
      evictIfNeeded();
    },
    delete(key) {
      const e = map.get(key);
      if (e === undefined) return;
      detach(e);
      map.delete(key);
    },
    invalidate(keyOrPrefix) {
      let count = 0;
      for (const k of Array.from(map.keys())) {
        if (k === keyOrPrefix || k.startsWith(keyOrPrefix)) {
          const e = map.get(k);
          if (e !== undefined) {
            detach(e);
            map.delete(k);
            count++;
          }
        }
      }
      return count;
    },
    size() {
      return map.size;
    },
  };
}

// ---------------------------------------------------------------------------
// Capability accessor
// ---------------------------------------------------------------------------

/** Surface a consumer block can call via `ctx.cap.toolCache.*`. */
export type ToolCacheAccessor = {
  store: () => ToolCacheStore;
  invalidate: (keyOrPrefix: string) => number;
  stats: () => { entries: number };
} & Record<string, (...args: any[]) => any>;

export interface CreateToolCacheCapabilityOptions {
  /** Default TTL (ms) for entries that don't specify one. Default 5 minutes. */
  defaultTtl?: number;
  /** Max entries before LRU eviction. Default 5000. */
  maxEntries?: number;
  /** Default scope for entries that don't specify one. Default `"run"`. */
  defaultScope?: "run" | "request" | "session";
  /**
   * Override the capability name. Defaults to `"toolCache"`. The Task
   * Board wiring passes a board-scoped name (e.g. `toolCache_<boardName>`)
   * so multiple boards in one flow don't collide.
   */
  name?: string;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 5000;

/**
 * Build a tool-cache capability. Each consumer block that installs it
 * (or each board that auto-installs it) gets a request-scoped store
 * exposed on the active context. The substrate's caching path inside
 * `compileToolsWithExecute` reads through `ctx._resolveToolCacheStore`
 * — that slot is populated for any block that lists the capability in
 * its `uses` chain.
 */
export function createToolCacheCapability(
  options: CreateToolCacheCapabilityOptions = {},
) {
  const name = options.name ?? "toolCache";
  const defaultTtl = options.defaultTtl ?? DEFAULT_TTL_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const defaultScope = options.defaultScope ?? "run";

  return defineCapability({
    name,
    fns: (ctx: BlockContext): ToolCacheAccessor => {
      const store = resolveOrCreateStore(ctx, name, {
        defaultTtl,
        maxEntries,
        defaultScope,
      });
      installResolverHook(ctx, store);
      return {
        store: () => store,
        invalidate: (keyOrPrefix: string) => store.invalidate(keyOrPrefix),
        stats: () => ({ entries: store.size() }),
      };
    },
  });
}

/**
 * Pull the store off a hidden bag on the request handle, creating it
 * lazily on first access. Single store per capability name per
 * request. Task Board wiring may install additional per-run cleanup
 * around the request-scoped lifetime.
 */
const STORE_BAG_KEY = "__fsd_toolCacheStores";

function resolveOrCreateStore(
  ctx: BlockContext,
  name: string,
  opts: { defaultTtl: number; maxEntries: number; defaultScope: "run" | "request" | "session" },
): ToolCacheStore {
  const req = ctx.request as unknown as Record<string, unknown>;
  let bag = req[STORE_BAG_KEY] as Record<string, ToolCacheStore> | undefined;
  if (bag === undefined) {
    bag = {};
    Object.defineProperty(req, STORE_BAG_KEY, {
      value: bag,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  const existing = bag[name];
  if (existing !== undefined) return existing;
  const store = createLruStore(opts);
  bag[name] = store;
  return store;
}

/**
 * Install (or re-confirm) the resolver hook on the active context. The
 * substrate's `resolveToolCacheStore` calls
 * `ctx._resolveToolCacheStore?.()` on every cacheable tool call; this
 * ensures the closure resolves to THIS store.
 */
function installResolverHook(ctx: BlockContext, store: ToolCacheStore): void {
  (ctx as { _resolveToolCacheStore?: () => ToolCacheStore }).
    _resolveToolCacheStore = () => store;
}

/**
 * Bind a cache store onto a context so any cacheable tool that runs
 * under that subtree resolves to it. Used by `taskBoard`'s outer
 * sequencer to scope the store to a single board run; consumers can
 * also call it directly to share a store across blocks without
 * going through the capability path.
 */
export function bindToolCacheStore(ctx: BlockContext, store: ToolCacheStore): void {
  installResolverHook(ctx, store);
}

/** Create a fresh store without going through the capability path. */
export function createInMemoryToolCacheStore(opts: {
  defaultTtl?: number;
  maxEntries?: number;
  defaultScope?: "run" | "request" | "session";
} = {}): ToolCacheStore {
  return createLruStore({
    defaultTtl: opts.defaultTtl ?? DEFAULT_TTL_MS,
    maxEntries: opts.maxEntries ?? DEFAULT_MAX_ENTRIES,
    defaultScope: opts.defaultScope ?? "run",
  });
}
