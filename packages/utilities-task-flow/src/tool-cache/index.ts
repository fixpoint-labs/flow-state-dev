/**
 * Tool-result memoization (FIX-610 Wave 1, Layer B).
 *
 * `createToolCacheCapability` returns a `DefinedCapability` that, when
 * installed on a block via `uses: [...]`, installs an in-memory cache
 * store and exposes it on the active `BlockContext` so the substrate
 * wrapping in `compileToolsWithExecute` can serve hits and write
 * misses. Bare generators benefit from the same primitive; Task Board
 * auto-installs it when `toolCache` is enabled.
 *
 * The store lives on `ctx.request.state` under a single namespaced
 * slot. We deliberately do NOT back this with a `defineResource`-based
 * persistent store in v1 — bounding lifetime to the request (or the
 * board run, whichever is shorter) is what makes the correctness story
 * tractable. Persistent backings are a Phase 2 follow-up.
 */
import { defineCapability } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";

// ---------------------------------------------------------------------------
// Store shape (mirrors the contract expected by core's cache-tool-call hook)
// ---------------------------------------------------------------------------

/** One cached tool-call entry. */
export interface ToolCacheEntry {
  output: unknown;
  storedAt: number;
  ttl?: number;
  toolName: string;
  sourceTask?: { collectionId: string; taskId: string };
}

/** Store accessor surface — matches the shape resolved by core's wrapping. */
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
 * exposed on the active context. The substrate's
 * `wrapToolExecuteWithCache` reads through `ctx._resolveToolCacheStore`
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
 * Pull the store off a hidden bag on the request handle, creating
 * it lazily on first access. Single store per capability name per
 * request. Task Board wiring may install additional per-run cleanup
 * around the request-scoped lifetime.
 *
 * The bag lives on `ctx.request` as a non-enumerable property — NOT
 * on `ctx.request.state` — because the runtime structured-clones
 * `state` for snapshots and the LRU store's `get` / `set` / `delete`
 * methods are functions, which would throw `DataCloneError`. The
 * request handle is shared by reference across every nested ctx, so
 * the bag is visible from any block that runs in the same request.
 */
const STORE_BAG_KEY = "__fsd_fix610_toolCacheStores";

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
 * Standalone helper for board wiring: bind a cache store onto a
 * context so any cacheable tool that runs under that subtree resolves
 * to it. Used by `taskBoard`'s outer sequencer to scope the store to a
 * single board run.
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

// Re-export the canonicalize helper so consumers writing custom keyFns
// can opt into the same normalization the substrate uses by default.
export { canonicalizeToolArgs } from "@flow-state-dev/core";
