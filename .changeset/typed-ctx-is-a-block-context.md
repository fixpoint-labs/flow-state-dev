---
"@flow-state-dev/core": minor
---

A block's own `ctx` passes to any helper typed `BlockContext`, with no cast, however the block is typed (FIX-2457).

- **core:** a block with `uses: [capability]` hands its `ctx` to a `BlockContext` helper (`resolveResourceCollection`, `getOrCreateTaskCollection`, `waitOnTask` and the rest). Before, a capability that declared no targets gave the block an open `ctx.targets` that no helper accepted, so the call needed `ctx as never`. A block that uses such a capability now reads a closed `ctx.targets`, as a block with no targets always did.
- **core:** a block that declares `targetStateSchemas` passes its `ctx` as a `BlockContext` too, and its own `ctx.targets` keeps exactly the handles it declared. A helper's plain `BlockContext` reads `ctx.targets` as an open map of untyped handles (`Record<string, StateRef | undefined>`); it was `Record<string, never>`.
- **core:** breaking for type checks only: `CapabilityPresetCtx<S>` is the consuming block's `BlockContext`, with session state `S` from the capability's `sessionStateSchema`. A preset callback (`tools`, `controlTools`, `context`, `model`, `providerOptions`, `caching`) passes its `ctx` to `BlockContext` helpers and reads `ctx.request`, `ctx.signal` and the rest typed. A key `BlockContext` does not declare is now a compile error instead of `any`, and a hand-built partial context no longer satisfies the type: build one with `createTestContext` from `@flow-state-dev/testing`. The runtime always passed the full block context; only the type changes.

Docs: apps/docs/docs/fundamentals/type-system.md (*When to reach for `LooseBlockContext`*: a typed block, one with targets or capabilities included, passes its `ctx` to a `BlockContext` helper as it is; stop sending readers to `LooseBlockContext` for typed targets), apps/docs/docs/fundamentals/capabilities.md (a preset callback's `ctx` is the block's `BlockContext`, session state typed from the capability; test one with `createTestContext`), packages/core/README.md (the `BlockContext` and `LooseBlockContext` entries, and `CapabilityPresetCtx`). FIX-2457.
