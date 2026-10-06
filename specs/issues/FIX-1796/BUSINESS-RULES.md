# FIX-1796 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Each says what a reader, an app or the guard meets and what
happens. The *proved by* column is the check the plan runs. "The guard" is the census, run in CI
from the last PR on.

## What is swept

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A retired term is on a line in scope: seat, hired seat, hired roster, mailbox, mailbox member or thread, room, talk session | It says the new term from the [epic's vocabulary](../../epics/FIX-1786/concept/CONCEPT.md#vocabulary): worker, roster, coordinator, delegate, the delegate's session, the project coordinator | The guard |
| BR-2 | "Kind" for the flow a worker runs on, "owner pin" or "flow instance" for a worker, on Workforce's ground (Workforce and Shift Manager source and docs, the glossary, any `workforce/` folder) | It says worker flow, access to the worker, or worker | The guard, Workforce ground only |
| BR-3 | "Seat" on a task board, in its types, its hand-off record, its docs or the discovery tool's text | It says assignee ([D1](DECISIONS.md#d1)) | The guard · typecheck |
| BR-4 | "Person" means the signed-in user | It says user | The guard |
| BR-5 | "Person" means any human: an author, a reviewer, someone a doubtful case goes to | It stays, pinned in the guard by file and phrase | Review of the exception list |
| BR-6 | A message a person or a model reads uses a retired term: a refusal, a tool's description or input values, a UI label, a test that asserts the text | Reworded in the new term; the test follows | The guard · tests |
| BR-7 | A docs heading is renamed ("Seats that hand off") | Every link to its anchor follows, across the site, guides and READMEs | Docs build, no broken-anchor warning |

## What keeps its word

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | A file is history: a retained spec, a changelog, a changeset, `docs/internal/`, the dated atlas, a blog post | Unchanged | The guard's areas |
| BR-9 | A file is in `goals/` | Its identifiers follow renamed exports; its words stay | Typecheck |
| BR-10 | The engine's flow `kind`, `flowKind`, a type's `kind` field, block and item kinds, flow instances and owner pins, the dispatch target | Unchanged ([ER-20](../../epics/FIX-1786/BUSINESS-RULES.md#what-no-child-may-do), [ER-22](../../epics/FIX-1786/BUSINESS-RULES.md#what-no-child-may-do)) | The guard's exceptions |
| BR-11 | A stored key, collection pattern, id or resource name uses a retired word | Its string is unchanged; the constant that holds it is renamed, `LEGACY_` when only an upgrade reads it ([D2](DECISIONS.md#d2)) | A store written before the sweep reads the same records after it |
| BR-12 | A refusal must name an old file or input: `MAILBOX.md`, a removed room action | It keeps naming it, with the conversion. Its module and test are listed by path | The guard's exceptions |
| BR-13 | Channel paths and `CHANNEL.md`'s `flow:` | Nothing here adds, renames or removes one | The guard's `channel-kind-paths` exception |

## Exports and upgrades

| # | When | Then | Proved by |
|---|---|---|---|
| BR-14 | An export is renamed | The old name is gone, with no alias. The package's changeset has a row, old to new, and the upgrading page lists it ([D3](DECISIONS.md#d3)) | Every name removed from a package's index appears in its changeset table |
| BR-15 | A custom worker flow hand-writes the worker configuration keys under the old names | Refused at boot, naming the flow and the key it lacks, as a hand-written schema missing a key is today | CI |
| BR-16 | A hand-off was saved or queued with `seat` before the upgrade | It runs and settles, read as `assignee`. Nothing new writes `seat` (BP-030) | CI, on a recorded record |
| BR-17 | A caller supplies both `seat` and `assignee` on a hand-off | `assignee` wins; the old field is never authority over the new one | CI |

## The glossary

| # | When | Then | Proved by |
|---|---|---|---|
| BR-18 | A reader opens the glossary's Workforce section | Each term in the [vocabulary](../../epics/FIX-1786/concept/CONCEPT.md#vocabulary) that has shipped is defined once; template and library wait for FIX-1795 | Review against the vocabulary table |
| BR-19 | Two glossary terms would mean one thing | One goes. Words that still mean two things (a board worker and a worker; Workforce's roster and Shift Manager's Roster screen) are listed together | Review |
| BR-20 | An entry says what a worker or coordinator keeps | It names only memory its flow really keeps (ER-15) | Review against the flow |

## Failure taxonomy

The guard is fatal in CI on any unswept line or any file without an area; an exception that
strips nothing is a warning to remove it. A renamed export with no changeset row fails V5. A
record saved before the sweep that no longer reads is a bug: D2 promised nothing moves. Nothing
retries.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): on the last PR's head, rebased on
`main`, the guard passes after it failed on `main` before the sweep and refused every plant
under `--control`, and typecheck, tests and the docs build are green. Plus the epic's ER-12,
which the closure checks again.
