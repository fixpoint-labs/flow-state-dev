# FIX-1543 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, written as rules. "The gate" is the check that refuses to register a hired seat
without an owner pin taken from its hire row. Every row in the first group is today's
behaviour, and the promise is that none of them moves.

## The gate refuses and admits exactly as today

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A hired seat is registered with no pin | Throws naming the owner pin; the register callback is never called | Existing `hire-plane` and `seat-hire-capability` suites, unchanged |
| BR-2 | The pin's `orgId` is empty | Same as BR-1 | Existing suites, unchanged |
| BR-3 | The pin is `{ orgId }`, or carries an empty `userId` | The callback receives `{ orgId }` alone, so an org-visible hire stays org-visible | Existing suites, unchanged |
| BR-4 | The pin is `{ orgId, userId }` | The callback receives both | Existing suites, unchanged |
| BR-5 | A manager seat's `hire` tool hires under an org | The callback receives the roster owner's pin, never one parsed from the address | Existing `seat-hire-capability` suite · goal `seat-hire/refuses-an-unpinned-register` |

## Every public name keeps working

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | Code imports `registerHiredSeat` or `hiredSeatOwnerPinFromRosterOwner` from the package root, the seat-hire module or the roster module | Every path yields the same function | New guard test |
| BR-7 | Code imports `HiredSeatOwnerPin` | It resolves, and is interchangeable with core's `InstanceOwnerPin` in both directions | `pnpm typecheck` |
| BR-8 | The kitchen-sink registrar and the durable-hire guide's example import from the root | Nothing in either changes, and the registrar typechecks | `pnpm typecheck` · the example read, since CI does not compile guide snippets |

## A second copy cannot come back quietly

| # | When | Then | Proved by |
|---|---|---|---|
| BR-9 | Someone adds another exported copy of either function | CI fails: the import paths no longer agree | New guard test |
| BR-10 | Someone pastes a private copy of the gate into package source | CI fails: the refusal sentence appears in two files | New guard test |

## Failure taxonomy

Nothing new can fail. The gate's one failure, the thrown refusal, is unchanged in when it fires
and what it says. The guard test fails only in CI, on a second copy.

## Acceptance criteria this issue owns

The package holds one definition of each function. `pnpm --filter @flow-state-dev/workforce
typecheck` and `test` pass, with no existing test's assertions edited. The kitchen-sink app
typechecks untouched, and the unpinned-register goal passes.
