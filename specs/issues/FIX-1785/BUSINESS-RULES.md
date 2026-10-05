# FIX-1785 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases D1 doesn't already answer. "Listed" means the mailbox or worker passes today's
declared-and-registered join (or FIX-1779's run-time rule); this issue changes what a listed
entry says, never whether it is listed.

## The door (core)

| ID | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A source returns an entry with `facts`, and the call asks `detail: "thin"` or passes no `detail` | The entry comes back with `facts`, unchanged, and without `contract` | CI, core |
| BR-2 | The same call asks `detail: "full"` | The entry comes back with `facts` and `contract` | CI, core |
| BR-3 | The call names no domain | Every domain answers as in BR-1/BR-2; no path drops `facts` | CI, core |
| BR-4 | A source returns an entry with no `facts`, or `facts: {}` | The entry has no `facts` key. Skills and resources entries are byte for byte what `main` returns | CI, core + existing suites |
| BR-5 | A source returns a `facts` value that is not a string, number, boolean or array of strings | That domain reports a `problem` naming the entry; every other domain still answers. Nothing is fatal, as today | CI, core |
| BR-6 | `contracts` and `core` | Name no `facts` key. The slot is generic | Review + a grep check in PLAN |

## Mailboxes (Workforce)

| ID | When | Then | Proved by |
|---|---|---|---|
| BR-7 | A listed mailbox, any detail | `facts.members` is the member list discover reads for it, in that order, full worker ids (`eng.em`, never `em`) | CI, workforce + goal |
| BR-8 | A listed mailbox with no members | `facts.members: []`. Empty is said, not left out | CI |
| BR-9 | A row written before `members` or `openedAt` existed (BP-030) | `members: []` as today; `openedAt` left out of `facts` when unrecorded | CI |
| BR-10 | A mailbox set up while the app runs (FIX-1779, if it has landed) | Same `facts` as a file mailbox | CI, after rebase |
| BR-11 | `detail: "full"` | `contract` says how it is addressed and that listed means registered, not open. It no longer lists members or the open time | CI |
| BR-12 | A large mailbox | Every member, no cap. A mailbox's member list is bounded by the org's workers | — |

## Workers (Workforce)

| ID | When | Then | Proved by |
|---|---|---|---|
| BR-13 | A listed worker, declared by file or hired at run time, any detail | `facts.workerKind` is the kind its inventory row records | CI + goal (held-out hire) |
| BR-14 | A worker row with an empty or missing kind | No `workerKind`. Never a default | CI |
| BR-15 | `detail: "full"` | `contract` is "Hand it work by its id." with no kind in it | CI |
| BR-16 | A worker whose file narrows `discover:` to some domains | Sees `facts` on the domains it sees; narrowing is unchanged | Existing suite |

## Failure taxonomy

Nothing new is fatal. A bad `facts` value degrades its domain to a `problem` (BR-5), the same way
a source that throws does today. Cancellation still propagates.

## Acceptance

- The [goal](SPEC.md#the-goal-and-how-well-know-its-met) passes, and fails under `GOAL_CONTROL=thin-withholds-facts`.
- `goals/org-seats/cos-changes-the-roster` **discover** leg, graded on tool output (#2768), green in 12 of 12 runs, the thin calls included.
- Every rule above has its check.
