# FIX-1238 — does a typed tap connector actually type the adjacency?

Throwaway. Never merges. It exists because the spec's whole recommendation rests on one
unchecked premise: that putting a *typed connector* on `.tap(boardMetaCompleted)` turns the
drain's "this tap must sit directly after the `forEach`" comment into something the compiler
enforces. Nobody had checked that, and the repo compiles with `strict: false`, which changes
the answer.

## Run it

```bash
pnpm install
pnpm --filter @flow-state-dev/contracts build
pnpm --filter @flow-state-dev/core build
npx tsc --noEmit -p spec-poc/FIX-1238-typed-tap-connector/tsconfig.json
```

**Expected: exactly five errors**, on lines 41, 45, 53, 63 and 78. Two of them (41, 45) are
deliberate — `probeA`/`probeB` assign the sequencer's output type to `string` so the compiler
prints what the type actually is. The other three are the finding. Silence on lines 48, 58 and
72 is also part of the result.

## What it showed

`probe.ts` reconstructs the drain's shape — a sequencer, a `forEach` over a worker-sequencer
factory, then the completion tap — and inserts things between the `forEach` and the tap.

| Line | Inserted between `forEach` and the tap | Breaks the carry at runtime? | Typed connector catches it? |
| --- | --- | --- | --- |
| 48 | nothing (today's wiring) | — | no error (no false positive) |
| 72 | `.tap(block)` | **no** — `tap` returns `{ value }` unchanged | no error (correct) |
| 53 | `.step(block)` with a declared output schema | yes | **yes** |
| 58 | `.step(block)` with no output schema | yes | **no** |
| 78 | `.stepIf(cond, block)` | yes, on the config where `cond` holds | **yes** |

Two type facts underneath it:

- **Line 41 — `forEach` over a *sequencer* factory yields `any[]`.** `SequencerDefinition`
  extends `BlockDefinition<any, any>`, so a nested sequencer's output type is erased. The
  drain's post-`forEach` type is `any[]`, not `CheckBoardOutput[]`. A typed connector therefore
  cannot assert the *element* shape — only that the flowing value is not some other type.
- **Line 45 — `forEach` over a plain *handler* yields `CheckBoardOutput[]`.** The erasure is
  specific to the sequencer factory, which is exactly the drain's shape.

The consequence for the spec: the connector is a real but **partial** guard. It closes the one
hole the drain tests cannot cover (line 78 — a conditional insert on a config the tests don't
exercise) and misses the schema-less insert (line 58). That is the honest strength of the
narrow fix, and it is what §3 argues from.

## The same experiment on the real drain

`probe.ts` reconstructs the shape. The decisive run was on the actual file — applied to
`packages/orchestration/src/task-board/index.ts`, typechecked, then reverted. Nothing of it
is on this branch; `index.ts` here is pristine. Reproduce it by hand:

1. Add `type CheckBoardOutput` to the existing `import { … } from "./schemas"` block (~line 122
   — the symbol is re-exported further down but is not in scope), and change
   `.tap(boardMetaCompleted)` to
   `.tap((exits: readonly CheckBoardOutput[]) => exits, boardMetaCompleted)`.
2. `npx tsc --noEmit -p packages/orchestration/tsconfig.json` → **clean.**
3. Now insert `.step(checkBoard)` immediately above that tap → **fails**, `TS2769` at the tap.
4. Revert the connector, keep the inserted step → **compiles clean.** That is the defect: the
   break is silent today.

So the guard costs one changed line plus one import, changes no runtime behaviour (the
connector is identity), and turns today's silent break into a compile error at the wiring site.
