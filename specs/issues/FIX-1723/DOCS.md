# FIX-1723 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

Shift Manager is a private app, so its README is its documentation. No `apps/docs` page and no
changeset: no published package changes.

## UPDATE · `labs/shift-manager/README.md` · "What you see" → the Sidebar bullet

Replace the bullet with:

- **Sidebar.** The organization, Jump to (⌘K), Inbox and Tasks with their counts, Roster with
  how many workers are on shift and on call, PROJECTS (the workstreams, until projects exist),
  and TEAMS: one row per team in the Lab's seat inventory, with how many of its workers are on
  shift and a square for each worker. Organization-level workers, such as a chief of staff,
  sit in one Staff row at the top. Hover a square for the worker and its status. Click a team
  to open Roster for that team. The footer repeats the on-shift and on-call counts.

## UPDATE · `labs/shift-manager/README.md` · "What you see" → after the Tasks bullet

- **Roster.** Every worker in the Lab, grouped by whether it's on shift, on call or off shift.
  Pick a team at the top to see only its workers. See [Roster](#roster).

## CREATE · `labs/shift-manager/README.md` · new section "Roster", after "A task"

## Roster

Roster shows every worker the Lab's seat inventory lists, in three groups:

- **On shift**: it holds a task that is running.
- **On call**: nothing of its is running, but it is waiting on you, either on a task it parked
  for you or on an ask in Inbox.
- **Off shift**: neither. A worker with only queued tasks is off shift until it claims one.

Each worker shows its team and kind, how many slots it has in use (one square per task it
holds), the tasks it holds, and what it is waiting on. Click a task to open it. The counts at
the top are for the workers shown.

The same status appears in the sidebar and in a workstream's panel, so a worker reads the same
everywhere.

Roster is read with the rest of the screen, when Shift Manager starts, on Retry and after you
answer an ask. It says when it was read. It doesn't refresh on its own.

Slots count what a worker holds now. Nothing in a Lab limits how many tasks a worker takes, so
Roster shows no capacity and no free slots.

## UPDATE · `labs/shift-manager/README.md` · "What isn't here yet"

Add:

- **What a worker is on call for, beyond you.** Webhooks, schedules and other standing watches
  arrive with the standing routines work. Until then on call means waiting on you, and a worker
  that only waits for a webhook reads off shift.
- **A declared map from a task's assignee to its worker.** Shift Manager matches the assignee to
  a worker by id, then by a unique name, then by who is in the channel. A task whose assignee
  matches no single worker counts for no one, so that worker can read off shift while it works.

## UPDATE · `labs/shift-manager/README.md` · "Tests"

After the third goal check, add:

A fourth serves a Lab of two teams whose workers are put into each status on purpose, opens
Roster for all teams and for each one, and compares every worker's status, slots, tasks and
waits with the Lab's store:

```bash
PLAYWRIGHT_BROWSERS_PATH=<your Chromium pool> pnpm tsx goals/shift-manager/it-shows-who-is-on-shift/run.mts
```

## Publication ownership

FIX-1723 publishes these after VG passes, reconciled against the shipped page. FIX-1722 edits
the same Sidebar bullet for Chief of Staff; whichever lands second merges the two sentences.
Voice: no internal issue ids in the README prose (the draft above names none), no em-dash
connectors, "worker" in this app's prose as the README already uses it.
