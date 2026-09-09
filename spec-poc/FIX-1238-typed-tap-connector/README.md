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

**Expected: exactly seven errors**, on lines 41, 45, 53, 63, 78, 98 and 111. Three of them
(41, 45, 98) are deliberate type-printers — they assign a sequencer's output type to `string`
so the compiler prints what the type actually is. **Silence is also part of the result**, on
lines 48, 58, 72, 87 and 99.

## What it showed

`probe.ts` reconstructs the drain's shape — a sequencer, a `forEach` over a worker-sequencer
factory, then the completion tap — and inserts things between the `forEach` and the tap.

| Line | Inserted between `forEach` and the tap | Breaks the carry at runtime? | Typed connector catches it? |
| --- | --- | --- | --- |
| 48 | nothing (today's wiring) | — | no error (no false positive) |
| 72 | `.tap(block)` | **no** — `tap` returns `{ value }` unchanged | no error (correct) |
| 53 | `.step(block)` with a declared output schema | yes | **yes** |
| 63 | the same `.step(block)`, but on a `forEach` over a plain **handler** — element type preserved, not erased (PROBE F) | yes | **yes** |
| 58 | `.step(block)` with no output schema | yes | **no** |
| 78 | `.stepIf(cond, block)` **with** a declared output schema | yes, on the config where `cond` holds | **yes** |
| 87 | `.stepIf(cond, block)` with **no** output schema | yes, on the config where `cond` holds | **no** |

Two type facts underneath it:

- **Line 41 — `forEach` over a *sequencer* factory yields `any[]`.** `SequencerDefinition`
  extends `BlockDefinition<any, any>`, so a nested sequencer's output type is erased. The
  drain's post-`forEach` type is `any[]`, not `CheckBoardOutput[]`. A typed connector therefore
  cannot assert the *element* shape — only that the flowing value is not some other type.
- **Line 45 — `forEach` over a plain *handler* yields `CheckBoardOutput[]`.** The erasure is
  specific to the sequencer factory, which is exactly the drain's shape.

Line 63 is the control for that pair: it re-runs line 53's insert on the handler-`forEach`, where
the element type survives. The guard catches the insert either way, which is what makes the
erasure a limit on *how much* the connector can assert (the element shape) rather than on
*whether* it catches an inserted step at all. The drain is the sequencer shape, so rows 48–78
above are the ones the spec argues from.

**What decides whether the guard sees an insert is whether the inserted block declares an
output — not whether the insert is conditional.** Lines 98 and 99 show the mechanism directly.
A `.stepIf` widens the flowing type to `pre | stepOutput`. With a declared output that union is
inspectable (line 98 prints `any[] | { totallyDifferent: string; }` and the connector rejects
it); with no declared output the step's own output is `any`, `any` absorbs the union, and the
result is plain `any` — which is why line 99 prints nothing and line 87 raises nothing. It is
the same blindness as line 58, reached by a second route.

The consequence for the spec: the connector is a real but **partial** guard, and the partiality
is one hole rather than two. It catches an inserted step that declares what it produces —
conditional (78) or not (53) — and misses one that declares nothing, conditional (87) or not
(58). So the slice it adds over the drain tests is narrower than "conditional inserts": it is
*conditional inserts that declare an output*.

## The same experiment on the real drain

`probe.ts` reconstructs the shape. The decisive run was on the actual file — applied to
`packages/orchestration/src/task-board/index.ts`, typechecked, then reverted. Nothing of it
is on this branch; `index.ts` here is pristine. Reproduce it by hand:

1. Add `type CheckBoardOutput` to the existing `import { … } from "./schemas"` block (~line 122
   — the symbol is re-exported further down but is not in scope), and change
   `.tap(boardMetaCompleted)` to
   `.tap((exits: readonly CheckBoardOutput[]) => exits, boardMetaCompleted)`.
2. `npx tsc --noEmit -p packages/orchestration/tsconfig.json` → **clean.**
3. Now insert `.step(checkBoard)` immediately above that tap → **fails**,
   `src/task-board/index.ts(1192,10): error TS2769`.
4. Revert the connector, keep the inserted step → **compiles clean.** That is the defect: the
   break is silent today.

Re-run 2026-09-09 against head `a7430c4f`, using `pnpm --filter @flow-state-dev/orchestration
typecheck` (the package's real check, not a hand-rolled `tsc` invocation). Same results.

So the guard costs one changed line plus one import, changes no runtime behaviour (the
connector is identity), and turns today's silent break into a compile error at the wiring site.

## Can the guard itself be regression-tested?

Only if the connector is a **named binding a test can import**. An inline arrow at the wiring
site is unreachable from outside the file: the connector's whole effect is on the compilation
of `index.ts`, and the drain leaves the module as `SequencerDefinition<any, any>` (declared at
`index.ts:580`), so nothing downstream can observe it. A self-contained "miniature drain" type
test carries its own connector and is therefore insensitive to the real one — verified below.

Measured on the real file, all four runs reverted:

| Run | Wiring | `@flow-state-dev/orchestration typecheck` |
| --- | --- | --- |
| 1 | inline typed connector | clean |
| 2 | inline typed connector + inserted `.step(checkBoard)` | `TS2769` at `index.ts(1192,10)` |
| 3 | connector weakened to `(exits: any) => exits`, step still inserted | **clean — the guard is gone and nothing fails** |
| 4 | connector named in its own module + a type test importing it, then weakened | **`TS2578` at the type test** |

Run 3 is the finding: weakening the connector erases the guard and no test anywhere goes red.
Run 4 is the fix — the test asserts on the connector itself rather than on a copy of it:

```ts
// @ts-expect-error - the completion-tap connector must reject a non-exits input
boardExitsConnector({ totallyDifferent: "x" });
```

A weakened `(exits: any)` connector accepts that input, the directive goes unused, and the
package typecheck fails with `TS2578`. Lines 107–112 of `probe.ts` are the same mechanism in
miniature. The type test must live under `src/` to be seen by the package's `typecheck` script
— run 4 used `src/task-board/tests/park-exit-guard.type-test.ts`.
