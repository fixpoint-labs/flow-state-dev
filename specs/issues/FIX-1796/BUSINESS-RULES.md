# FIX-1796 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Each says what a reader, an app or the guard meets and what
happens. The *proved by* column is the check the plan runs. "The guard" is the census, run in CI
from the last PR on.

## What is swept

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A retired term is on a line in scope: seat (Workforce's), hired seat, hired roster, mailbox, mailbox member or thread, room, talk session | It says the new term from the [epic's vocabulary](../../epics/FIX-1786/concept/CONCEPT.md#vocabulary): worker, roster, coordinator, delegate, the delegate's session, the project coordinator | The guard; "member" and "thread" on Workforce's ground |
| BR-2 | "Kind" for the flow a worker runs on, "owner pin" or "flow instance" for a worker, on Workforce's ground: Workforce and Shift Manager source and docs, the glossary, any `workforce/` folder, and any file that imports Workforce or Shift Manager wherever it sits | It says worker flow, access to the worker, or worker | The guard, Workforce ground only; a control plant in a kitchen-sink file |
| BR-3 | "Seat" on a task board: a place in its registry, its `TaskSeat…` and `HandOffSeat` types, the hand-off record's `seat` field | It stays ([D1](DECISIONS.md#d1)). Where a board's text means the seat on one task, it says assignee. Where it means a Workforce worker ("a hired seat"), it says worker. Saved and queued hand-offs are untouched | The guard's board-seat exceptions, and a control plant with both seats on one line |
| BR-4 | "Person" means the signed-in user, on Workforce's ground | It says user | The guard, Workforce ground only |
| BR-5 | "Person" means a human who isn't the signed-in user: an author, a reviewer, someone a doubtful case goes to | It stays, pinned in the guard by file and phrase; a second "person" on the line still counts | Review of the exception list · a control plant |
| BR-6 | A message a person or a model reads uses a retired term: a refusal, a tool's description or input values, a UI label, a test that asserts the text | Reworded in the new term; the test follows | The guard · tests |
| BR-7 | A docs heading is renamed ("Reading one seat's skills") | Every link to its anchor follows, across the site, guides and READMEs | Docs build, no broken-anchor warning |

## What keeps its word

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | A file is history: a retained spec, a changelog, a changeset, `docs/internal/`, the dated atlas, a blog post | Unchanged | The guard's areas |
| BR-9 | A file is in `goals/` | Its identifiers follow renamed exports; its words stay | Typecheck |
| BR-10 | The engine's flow `kind`, `flowKind`, a type's `kind` field, block and item kinds, flow instances and owner pins, the dispatch target | Unchanged ([ER-20](../../epics/FIX-1786/BUSINESS-RULES.md#what-no-child-may-do), [ER-22](../../epics/FIX-1786/BUSINESS-RULES.md#what-no-child-may-do)) | The guard's exceptions |
| BR-11 | A stored key, collection pattern, id, resource name, or a field name inside a saved record, uses a retired word | Its string is unchanged; the constant or type that holds it is renamed, `LEGACY_` when only an upgrade reads it, and a renamed type reads the stored field through one mapper ([D2](DECISIONS.md#d2)) | A store written before the sweep reads the same records after it |
| BR-12 | A refusal must name an old file or input: `MAILBOX.md`, a removed room action | It keeps naming it, with the conversion. Its module and test are listed by path | The guard's exceptions |
| BR-13 | Channel paths and `CHANNEL.md`'s `flow:` (ER-20) | None is tracked on `main`, and nothing here adds one, so the guard carries no exception for them | `git ls-files`: no `flows/channels/` path ([settled](DECISIONS.md#settled)) |

## Exports and upgrades

| # | When | Then | Proved by |
|---|---|---|---|
| BR-14 | An export is renamed | The old name is gone, with no alias. The package's changeset has a row, old to new, and the upgrading page lists it ([D3](DECISIONS.md#d3)) | Every name removed from a package's index appears in its changeset table |
| BR-15 | A custom worker flow hand-writes the worker configuration keys under the old names | Refused at boot, naming the flow and the key it lacks, as a hand-written schema missing a key is today | CI |
| BR-16 | A model, a saved prompt, skill or eval, or a worker file's `discover:` names the discovery domain `seats` | `workers` answers what `seats` did. `seats` gets the "unknown domain" listing, and a worker file naming it is refused when it is minted, listing the known domains; no alias ([D4](DECISIONS.md#d4)). `mailboxes` is FIX-1792's | CI · the changeset row names the cost |

## The glossary

| # | When | Then | Proved by |
|---|---|---|---|
| BR-17 | A reader opens the glossary's Workforce section | Each term in the [vocabulary](../../epics/FIX-1786/concept/CONCEPT.md#vocabulary) that has shipped is defined once; template and library wait for FIX-1795 | Review against the vocabulary table |
| BR-18 | A reader looks up "seat" or "assignee" | The task-board section defines both, once: a seat is a place on a board, an assignee is a seat on one task ([D1](DECISIONS.md#d1)) | Review |
| BR-19 | Two glossary terms would mean one thing | One goes. Words that still mean two things (a board worker and a worker; Workforce's roster and Shift Manager's Roster screen) are listed together | Review |
| BR-20 | An entry says what a worker or coordinator keeps | It names only memory its flow really keeps (ER-15) | Review against the flow |

## Failure taxonomy

The guard is fatal in CI on any unswept line, any file without an area, any exception that
strips nothing, and any board file on Workforce's ground. A renamed export with no changeset row fails V5. A
record saved before the sweep that no longer reads is a bug: D2 promised nothing moves. Nothing
retries.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): on the last PR's head, rebased on
`main`, the guard passes after it failed on `main` before the sweep and refused every plant
under `--control`, and typecheck, tests and the docs build are green. Plus the epic's ER-12,
which the closure checks again.
