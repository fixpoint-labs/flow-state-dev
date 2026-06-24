# Design: External SDK Binding Lifecycle (FIX-125)

> Persistent agent bindings across requests within a flow session.

## 1. Problem

When a block wraps an external SDK (Claude Code SDK, Gemini, etc.), two kinds of state exist:

- **Data state** (external session ID, task status) — persists fine in `sessionStateSchema` or a resource.
- **Runtime binding** (live SDK instance, open connection) — dies when the block returns. Next request creates a new instance from scratch.

The framework has no mechanism to bridge the gap: reconstruct or cache a live binding from persisted data across requests within a session.

## 2. Approach: Hybrid Reconstruction + Optional Binding Cache

Default to stateless reconstruction from a persisted external session ID. Provide an opt-in, framework-managed per-process binding cache for cases where reconstruction is expensive.

### Why

- **Stateless reconstruction** is correct under horizontal scaling and process restarts. No sticky-session requirement.
- **Binding caching** is a performance optimization, not a correctness requirement. Making it opt-in avoids complexity for the common case.
- The SDKs we care about most (Claude Code SDK `query()` with `sessionId`, Gemini) support cheap resume-by-ID, so reconstruction is the natural default.
- A framework-managed cache beats a module-level convention: visibility into binding lifetimes for cleanup, metrics, and observability.

## 3. Design

### 3.1 Persisted Binding Identity — Use Session State

External session/task IDs are stored in `sessionStateSchema` or a session-scoped resource. Already supported. No new primitives needed.

```typescript
const agentFlow = defineFlow({
  kind: "agent-session",
  session: {
    stateSchema: z.object({
      externalSessionId: z.string().optional(),
      externalStatus: z.enum(["idle", "active", "completed"]).default("idle"),
    }),
  },
});
```

### 3.2 Binding Reconstruction Contract — `BindingProvider<T>`

A new interface that blocks use to obtain a live SDK binding from persisted identity. This is the core abstraction.

```typescript
/**
 * Provides a live SDK binding from a persisted identity key.
 * Reconstruction must be idempotent — calling resolve() twice
 * with the same key returns equivalent bindings.
 */
export interface BindingProvider<TBinding> {
  /** Obtain or reconstruct a binding from a persisted key. */
  resolve(key: string): Promise<TBinding>;

  /** Release a binding when it's no longer needed. Optional. */
  release?(key: string): Promise<void>;
}
```

Blocks receive the provider via their config, not via `BlockContext`. This keeps the framework core clean — the provider is a user-supplied dependency, not a framework primitive.

```typescript
const claudeBlock = defineHandler({
  name: "claude-agent",
  execute: async (input, ctx) => {
    const sessionId = ctx.session.state.externalSessionId;
    const binding = await claudeProvider.resolve(sessionId ?? "new");

    if (!sessionId) {
      await ctx.session.patchState({ externalSessionId: binding.sessionId });
    }

    const result = await binding.query(input.message);
    return result;
  },
});
```

### 3.3 Optional Binding Cache — `createBindingCache<T>()`

A framework-provided utility (in `@flow-state-dev/engine`) that wraps a `BindingProvider` with per-process LRU caching and TTL eviction. Blocks opt in explicitly.

```typescript
import { createBindingCache } from "@flow-state-dev/engine";

const claudeCache = createBindingCache<ClaudeSession>({
  provider: {
    resolve: async (key) => new ClaudeSession({ sessionId: key }),
    release: async (key) => { /* optional cleanup */ },
  },
  maxSize: 100,
  ttlMs: 30 * 60_000,
  onEvict: (key, binding) => {
    binding.disconnect?.();
  },
});
```

`createBindingCache` returns a `BindingProvider<T>` — same interface, so blocks don't know or care whether caching is active.

Internal implementation:

```typescript
export function createBindingCache<T>(options: BindingCacheOptions<T>): BindingProvider<T> & Disposable {
  const cache = new Map<string, { binding: T; lastAccess: number; timer: ReturnType<typeof setTimeout> }>();

  return {
    async resolve(key: string): Promise<T> {
      const entry = cache.get(key);
      if (entry) {
        entry.lastAccess = Date.now();
        return entry.binding;
      }

      const binding = await options.provider.resolve(key);
      // LRU eviction if at capacity, set TTL timer
      cache.set(key, { binding, lastAccess: Date.now(), timer });
      return binding;
    },

    async release(key: string): Promise<void> {
      const entry = cache.get(key);
      if (entry) {
        clearTimeout(entry.timer);
        cache.delete(key);
        await options.provider.release?.(key);
        options.onEvict?.(key, entry.binding);
      }
    },

    [Symbol.dispose]() {
      for (const [key, entry] of cache) {
        clearTimeout(entry.timer);
        options.onEvict?.(key, entry.binding);
      }
      cache.clear();
    },
  };
}
```

### 3.4 Session Cleanup — No Framework Change Needed (Phase 1)

The issue asks about `onSessionEnded`. In Phase 1, explicit cleanup is handled by:

1. **TTL eviction** on the binding cache (bindings expire naturally).
2. **`release(key)`** called manually when a block knows the session is done.
3. **`Symbol.dispose`** on process shutdown.

A formal `onSessionEnded` server-side event is a Phase 2 concern (tracked by FIX-140 / durable execution). For Phase 1, TTL-based eviction is sufficient.

### 3.5 Horizontal Scaling

The design is correct under horizontal scaling without sticky sessions:

- **Default path** (stateless reconstruction): Any server can handle any request. Reads external ID from session state, reconstructs binding. No shared memory needed.
- **Cached path**: Cache is per-process. Cache miss on a different server triggers reconstruction. Performance trade-off, not correctness issue.

No sticky-session routing required.

## 4. Package Placement

| Artifact | Package | Rationale |
|----------|---------|-----------|
| `BindingProvider<T>` interface | `@flow-state-dev/core` | Pure type contract, no runtime. Blocks in any package can reference it. |
| `createBindingCache()` | `@flow-state-dev/engine` | Runtime utility with timers, LRU, `Symbol.dispose`. Server-only. |
| SDK-specific providers | User-land / examples | Not framework code. Each SDK integration supplies its own provider. |

## 5. Answers to Issue Questions

**Q1: Do the SDKs we care about support cheap resume-by-ID?**
Yes. Claude Code SDK `query()` accepts `sessionId` for continuity. Gemini has session-based APIs. Stateless reconstruction is sufficient as the default.

**Q2: What does the cleanup contract look like?**
Phase 1: TTL eviction + explicit `release()` + `Symbol.dispose`. No `onSessionEnded` framework event yet. Phase 2 (FIX-140) can add it as a durable execution lifecycle event.

**Q3: Framework `ctx.bindingCache` accessor vs module-level Map?**
Neither. `BindingProvider` is the contract. `createBindingCache()` is a standalone utility — not on `ctx`. Avoids polluting BlockContext while still being framework-provided.

**Q4: Horizontal scaling?**
Stateless reconstruction is the default. Binding cache is per-process and optional. No sticky sessions required.

**Q5: How does this connect to FIX-140 (durability)?**
Binding reconstruction from persisted IDs is exactly what a `DurabilityProvider` checkpoint/resume would trigger. `BindingProvider.resolve()` is the same operation. When FIX-140 lands, it can call `resolve()` as part of recovery.

## 6. Implementation Scope

### Files to create

- `packages/core/src/types/binding.ts` — `BindingProvider<T>` interface + types
- `packages/engine/src/bindings/createBindingCache.ts` — Cache utility
- `packages/engine/src/bindings/index.ts` — Public exports
- `packages/engine/src/bindings/__tests__/createBindingCache.test.ts` — Unit tests

### Files to modify

- `packages/core/src/types/index.ts` — Re-export binding types
- `packages/engine/src/index.ts` — Re-export `createBindingCache`

### What this does NOT include

- No changes to `BlockContext`, `FlowDefinition`, `executeBlock`, or `runAction`
- No new lifecycle hooks
- No SDK-specific provider implementations (user-land or future `@flow-state-dev/integrations`)

## 7. Verification Plan

1. Unit tests for `createBindingCache`: resolve/cache-hit, TTL eviction, LRU eviction, release, Symbol.dispose, concurrent resolve dedup
2. `pnpm typecheck` passes
3. `pnpm test` passes
4. Integration sketch: test simulating multi-request agent flow with `BindingProvider` + session state
