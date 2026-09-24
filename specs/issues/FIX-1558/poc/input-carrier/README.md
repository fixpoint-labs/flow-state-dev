# POC · how a leaf gets the cascade's original input

Retained evidence for [DECISIONS.md → D1](../../DECISIONS.md#d1) and
[Settled](../../DECISIONS.md#settled). An experiment, not a supported API. Nothing imports it,
and it is outside default test, lint and knip discovery (`specs/` is not a workspace member).

It needs FIX-1554's evaluator, so it runs on that implementation branch (#2206), copied into the
engine's tests:

```bash
git switch --detach origin/fix/FIX-1554-core-evaluator-block   # or main, once FIX-1554 has merged
pnpm install
git show origin/spec/FIX-1558:specs/issues/FIX-1558/poc/input-carrier/carrier.poc.test.ts \
  > packages/engine/test/carrier.poc.test.ts                   # origin/main once this spec merges
pnpm --filter @flow-state-dev/engine exec vitest run test/carrier.poc.test.ts   # 5 pass
```

## The question

A level asks its evaluator, and the evaluator returns `{ answers }` only. The leaf at the end
of the walk must still receive the ticket the cascade was called with, and each evaluator must
stay its own traced step so resume replays its answer. The first draft carried the input with
a `.parallel()` pass-through rail, which the public sequencer can't build without an identity
handler. Is there a public composition that does both?

## The composition it runs

```
cascade    = sequencer(name).step(rootLevel)                          a container
rootLevel  = sequencer.step(evaluator).step(gate).step(router)
nested     = sequencer.step((env) => env.input, evaluator).step(gate).step(router)
gate       = handler: (answers, ctx) => { input: <its level's input from ctx.parent.input>, verdict }
leaf       = block.connectInput((env) => env.input)                    also ambiguous
```

`ctx.parent` is public on every block's context and documented as "the input it was called
with". Inside a level, the gate's parent is the level's sequencer.

## Legs

| # | Check | Result |
|---|---|---|
| 1 | Two levels on the mock evaluation model: the leaf receives the original ticket | pass |
| 2 | Each evaluator is its own `block_trace` row (`dept`, `urg`) | pass |
| 3 | The leaf suspends; on resume neither evaluator is called again, the route matches, the leaf gets the ticket | pass |
| 4 | `testBlock` run on the cascade itself | pass |
| 5 | The cascade as an action's own root block | pass |
| a | **Control:** leaves without the unwrap connector receive the envelope, so leg 1 can fail | fails leg 1 as it should |
| b | **Control:** the root level with no container, as an action's root block | no input reaches it |

## What it showed (2026-09-24, #2206 at `4c13e79`)

The carrier works with the public API and no engine change. Two facts shaped it, and the
implementation must keep both:

- **`ctx.parent.input` is undefined for the block a run starts at.** The engine's root
  `executeBlock` opens its scope without the input, where a sequencer's steps pass it. So a
  level must never be the outermost block: the container is what makes the root level a child
  (control b). A one-line engine fix would remove the need; that is a separate bug, not this
  issue's scope.
- **A sequencer's `connectInput` is its first step**, so `ctx.parent.input` is the value before
  the connector. A nested level therefore takes the envelope as its input and unwraps it
  explicitly on the evaluator step and in the gate, rather than via `connectInput`.
