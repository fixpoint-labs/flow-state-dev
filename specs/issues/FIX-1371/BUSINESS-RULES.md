# FIX-1371 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, written as rules. "The worker door" is hiring a roster of worker records. "The
channel door" is the channel side's kind reader and every path through it: building the
channel instances, opening their sessions, and writing the inventory. Every row is today's
behaviour. The promise is that none of them moves.

"Present" means the record has its own `flow` key, whatever it holds.

## The worker door decides exactly as today

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | No `flow` key | Hired on the built-in `agent` kind | Existing `agent-worker-flow` suite, unchanged |
| BR-2 | `flow` is a blank string (`""`, `"   "`) | Refused, naming the worker, with today's "empty `flow:`" sentence | Existing `hire` suite (blank) · new row (`""`) |
| BR-3 | `flow` is present but not a string (`null`, `undefined`, `42`, an object) | Refused, naming the worker and quoting the value, with today's "names no flow kind" sentence | Existing `hire` suite (`null`, `42`) · new rows (`undefined`, object) |
| BR-4 | `flow` names a kind that was passed | Hired on that kind | Existing `hire` suite, unchanged |
| BR-5 | `flow` names a kind that was not passed, or a prototype key like `"constructor"` | Refused as "not passed to hireWorkforce", never hired on the built-in | Existing `hire` suite, unchanged (this lookup is not moved) |

## The channel door decides exactly as today

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | No `flow` key | Opened on the built-in `channel` kind | Existing `channel-binder` suite, unchanged |
| BR-7 | `flow` is a blank string | Refused: "declares a `flow:` that is not a kind name" | **New** characterization rows, green on `main` first |
| BR-8 | `flow` is present but not a string (`null`, `undefined`, `42`, an object) | The same refusal as BR-7, word for word | **New** characterization rows, green on `main` first |
| BR-9 | `flow` names a kind that was not passed | Refused as "not passed to channelInstances" | Existing `channel-binder` suite, unchanged |
| BR-10 | Opening sessions or writing the inventory for a record | Reads the same kind, or the same refusal, as building the instances did | Existing suites: they call the same reader as today |

## One rule

| # | When | Then | Proved by |
|---|---|---|---|
| BR-11 | Someone changes how the rule classifies a `flow` value | Both doors change together | Negative control: a planted change turns the matching rows on both doors red ([PLAN → V2](PLAN.md#checks)) |
| BR-12 | Package source is searched for the "is the `flow` key present" check | It appears once, in the shared rule | One-time grep ([PLAN → V3](PLAN.md#checks)) |

## Failure taxonomy

Nothing new can fail. Each door's refusals fire on the same inputs with the same sentences.
The shared rule throws nothing: it returns a case, and each door turns a refusal case into
its own sentence as it does today.

## Acceptance criteria this issue owns

The package has one definition of the rule, and both doors reach it.
`pnpm --filter @flow-state-dev/workforce typecheck` and `test` pass with no existing
assertion edited, and the new characterization rows pass on `main` before the change and
after it.
