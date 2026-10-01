# FIX-960 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, written as rules. Each says what a caller does and what happens. *Proved by* is the
check the plan runs. Every rule except BR-4 restates today's behaviour under the new spelling:
that is the whole promise.

## Where tasks are stored

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A caller writes `backing: "state"` with a `state` ref and no `stateKey` | Tasks live at `tasks` on that ref, as the sequencer arm does today | New default-slot test (V2) |
| BR-2 | A caller writes `backing: "state"` with no `state` and no `stateKey` | Tasks live on the request at the `collectionId`, as the request arm does today. Two boards in one request stay apart | New default-slot test (V2) |
| BR-3 | A caller passes `stateKey` | That slot, with or without `state` | Existing suite |
| BR-4 | A caller sends `"sequencer"` or `"request"` | A type error for a typed caller. At runtime, a thrown error that names `backing: "state"`, before any storage is touched | Type-test under `@ts-expect-error` (V3) · unit test (V3) |
| BR-5 | The delegation board's own-state resolver and the delegation surface's capped resolver build their collections | Both write the generator's `delegationBoard` field, as today | Existing delegation suites |

## Caps and backings

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | Caps are set on the `state` arm, with or without `state` | Enforced exactly as on today's two arms | Existing cap suites |
| BR-7 | Caps are set on `backing: "resource"` | A type error, as today | `task-caps.type-test.ts`, rewritten to the new arm |
| BR-8 | `backing: "resource"` is used | Unchanged in every respect | Existing suite |

## What neighbours see

| # | When | Then | Proved by |
|---|---|---|---|
| BR-9 | Any collection changes a task | The same `task-change` items, keys and claim identity | Existing suite |
| BR-10 | A board is built with `taskBoard({ collection })` | Its spec, `board.backing` value and error messages are unchanged | Existing board suites · census board count unchanged (V4) |

## Failure taxonomy

Nothing new can fail at runtime except BR-4, which replaces today's obscure failure in the
resource branch with a named one. Every other case is a compile-time rename.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): typecheck and tests green before and
after across every dependent, zero old-spelling collection sites in the census, both default
slots pinned by a test that fails if either is swapped, and the old literal rejected.
