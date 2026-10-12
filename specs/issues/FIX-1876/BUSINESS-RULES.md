# FIX-1876 · Rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Every case the decisions don't already answer: when → then → proved by. IDs are `WR-n` (word
rules). The plan turns each into a check.

## Which word a use gets

| # | When | Then | Proved by |
|---|---|---|---|
| WR-1 | A name, phrase or comment is about a turn that parks until a task row ends | It says **wait**: a wait gate, a waited-on row, the waiting turn | The sweep's `ask-*` rules |
| WR-2 | It is about a board or a worker starting a task in another session (a dispatcher assignee, the drain's dispatch, the child that runs the row) | It says **dispatch**: a dispatching assignee, a dispatched row, the `"dispatched"` ending | The sweep's `handoff-*` rules |
| WR-3 | It is a question or approval to a person: Shift Manager's Ask and Inbox, an approval, the harness question inbox, the chief of staff's approval before a fire | It keeps **ask**, and gets a keep-list entry with that reason | The keep list, read in review |
| WR-4 | It is a session passing its own work on mid-work | It keeps **hand-off**. Nothing in the code does this today, so the sweep should find no such use; one it finds is read in review before it is kept | The keep list, read in review |
| WR-5 | It is "hand off" or "asked" in an unrelated sense (a record passed to its holder, "the state I asked for") | Reword it where that is cheap; otherwise keep it with the reason | The keep list |
| WR-6 | It is in a retained spec, a `CHANGELOG.md`, a dated blog post, or a goal directory's path | It keeps its word: that is history | The sweep's named exclusions |
| WR-7 | It is a pending `.changeset` fragment announcing `post-to-mailbox` | It is amended so the release notes don't announce a removed tool. A goal log's dated verdict row mentioning it is history and is kept | The `post-to-mailbox` rule |

## Records written before the upgrade

A wait parked when the server upgrades is the case D2 exists for. These marks are read under
both names and written under the new one only.

| # | When | Then | Proved by |
|---|---|---|---|
| WR-8 | A task row stored with `ask: { gateId, deadline }` | It reads as waited on: the notice resumes its turn, listing shows it waited on, a stop or timeout cancels it as today | Leg 2 · a unit check per reader |
| WR-9 | A suspension stored with reason `"ask"` | It is a wait gate everywhere a wait gate is tested: the resume operation finds it, the durability sweep times it out at its deadline, and it is never an expired approval | Leg 2 · the sweeper's and resume path's tests, with an `"ask"` record |
| WR-10 | The public resume route is asked to resume an old `"ask"` gate | It answers not-found, as it does for a new wait gate. A legacy gate must never become resumable from outside its conversation | Leg 2's signal · a route test with an `"ask"` record |
| WR-11 | A turn replays a wait call whose filing was recorded under `fsd.ask.step`, `fsd.ask.plan` or `fsd.ask.file` | It finds that record and does not file a second row: the colleague's work runs once | Leg 2 counts one row · the filing test's existing legacy cases, kept |
| WR-12 | A gate id minted as `ask:<board>:<task>#…` | It is found by its stored id, as every gate is, so it needs no reader. New ids use `wait:` | Leg 2 |
| WR-13 | A stored notice, owed before the upgrade, carries the old waited-on flag | It reads as waited on: its ending resumes the turn and wakes none | A notice-decision test with the old flag |
| WR-14 | An item log stored before the upgrade has a board ending `"handed-off"`, or a dispatch block output with `handedOff: true` | Every reader of it in the framework (Shift Manager, the DevTool, the board's own readers) treats it as `"dispatched"` | A reader test with an old log |
| WR-15 | Any writer | Writes the new name only. No write path emits an old mark after the upgrade | The sweep: a writer is not a legacy reader, so it has no `legacy-name:` marker and fails |

## Public names

| # | When | Then | Proved by |
|---|---|---|---|
| WR-16 | An app imports a renamed export (`parkOnAsk`, `isAskGate`, `AskEndedError`, `createHandOff` and the rest of [the map](PLAN.md#pinned-names)) | It fails to compile, naming the missing export. No alias is kept | Typecheck · the changeset names each pair |
| WR-17 | An app matches a board's ending against `"handed-off"` | Its match no longer fires on new runs. The changeset says so in its first line, with the new value | The changeset, read in review |
| WR-18 | A person follows an old link to `task-board#assignees-that-hand-off` | It lands on the renamed section | The docs build's broken-anchor check |
| WR-19 | One of the epic's regression checks reads a renamed mark (FIX-1816's reads a row's `ask`) | Only that read changes, to the new name, and the change is in the rename map the closure checks | The closure's rename-map script ([ER-11](../../epics/FIX-1870/BUSINESS-RULES.md#what-no-child-may-do)) |

## The sweep

| # | When | Then | Proved by |
|---|---|---|---|
| WR-20 | A tracked file under a swept root has no rule that scans it and no exclusion | The sweep fails, naming it (totality) | `0 with no rule` |
| WR-21 | A keep-list entry or exclusion has no reason | It is refused in review; every entry says why | Review |
| WR-22 | FIX-1875 or FIX-1872 already renamed a name on the list | The sweep stops finding it, and the upstream name stands | The sweep on the merged commit |

## Failure taxonomy

| Failure | Shape | Who sees it |
|---|---|---|
| A renamed export | Compile error naming the export | An app developer, at upgrade |
| A legacy mark not read | A parked turn never resumes; the sweep can't catch it | A person waiting on a colleague: the answer is lost. Leg 2 is the guard |
| A legacy gate resumable from outside | A security regression | Nobody, until exploited. WR-10 is the guard |
| A missed use | `OPEN > 0` in the sweep | The implementer, before the PR |

## Acceptance criteria this issue owns

- The sweep passes on the commit where all three PRs have merged, and its control fails.
- Leg 2 passes, and fails with the legacy readers removed.
- The glossary and the task board pages carry the rows and sections in [DOCS.md](DOCS.md).
- [ER-7](../../epics/FIX-1870/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt) and
  [ER-17](../../epics/FIX-1870/BUSINESS-RULES.md#the-closure) hold for the closure's docs walk.
