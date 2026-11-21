# POC · memory reaches another kit's flows with no `provides`

**Question.** FIX-2836 proposes `provides` because memory's draft kit (#5434) can only hand
its built system to flows through a builder slot. Can memory reach a kit's flows today,
with no new API, if the system is built once at module scope by `system(config)`?

**Answer: yes.** Kind: characterization (the premise of [D1](../../DECISIONS.md#d1)).

| Leg | What runs | Reads |
|---|---|---|
| a | The real `workforce` kit, started with `fill: { [workforce.slots.uses]: [mem.capability] }` | Workforce's `agent` worker flow carries `workingMemory` and `memorySystem` |
| b | `fsdev run team remember`: a block in a stand-in kit with a `uses` list slot, which never imports memory | `ctx.cap` holds `workingMemory` and `memory`; two writes read back |

Under the control `POC_CONTROL=no-fill` both legs must fail: the agent flow carries no memory
resources, and the block throws `ctx.cap.workingMemory is absent`.

```bash
# from the repo root
packages/fsdev/node_modules/.bin/tsx specs/issues/FIX-2836/poc/memory-without-provides/run.mts
POC_CONTROL=no-fill packages/fsdev/node_modules/.bin/tsx specs/issues/FIX-2836/poc/memory-without-provides/run.mts
```

Run on 2026-11-21 against `b36b369e8b`:

```
a · workforce agent flow's memory resources: ["workingMemory","memorySystem"]
b · ctx.cap: ["workingMemory","memory"]; working memory read back: ["the user prefers short answers","the deploy is on Friday"]
PASS
```

Control:

```
a · workforce agent flow's memory resources: []
FAIL
  - a · the agent flow should carry workingMemory and memorySystem, got []
  - b · fsdev run team remember failed (exit 1): … ctx.cap.workingMemory is absent: memory never reached this flow
```

**Found on the way.** A handler cannot take the composed `mem.capability` as is: its default
presets add prompt context, and `handler()` throws `Capability "memory" preset "working"
declares context, but the consuming block is a handler`. Leg b passes
`mem.capability.with({ working: false, digest: false, recall: false })`. So the block in
FIX-2836's sketch (`handler({ uses: [memory.capability] })`) would throw as written, with or
without `provides`. The sketch's `ctx.cap.memory.remember` does not exist either: the composed
capability's functions are `recall`, `connections`, `relate` and `egoGraph`.

Throwaway. It imports the packages' `src` by relative path and is not a workspace member, so
no production discovery reaches it.
