# FIX-2397 · Decisions

[Spec](SPEC.md) · **Decisions**

<a name="d1"></a>
## D1 · What "needs you" means

A teammate needs you when its conversation holds an approval with no answer yet, or one of its
tasks has an open hold (`BoardTask.waiting`, from FIX-2379's row view). Nothing else: an unread
line is unread, not a need.

- **Wording:** an approval reads *Needs your OK: <what it asks>*, as the issue asks. A held task
  reads *Waiting on you: <prompt>*, FIX-2379's phrase, because ER-4 makes the row view the one
  waiting vocabulary. Both share the tier and the badge.

<a name="d2"></a>
## D2 · Badge the row; don't move it

| | Badge in place (chosen) | Sort rows that need you to the top |
|---|---|---|
| Finds the teammate fast | yes, the badge is in the attention colour | yes |
| The list moves under your pointer or keyboard focus | no | yes, whenever a need opens or closes |

- **Because:** the issue says the status is "sorted first". We read that as first in the status
  line's order, which this does. Reordering a roster of a handful of teammates buys little and
  breaks the keyboard order FIX-2401 set.
- **What would change it:** rosters long enough that a badge scrolls out of sight.

<a name="d3"></a>
## D3 · The title counts teammates that have something for you

`(N) Teammates`, N = teammates with an unread line or a need. A teammate counts once.

- **Because:** it matches the list: N is how many rows are asking for you. Counting lines would
  make a chatty teammate dominate it.

<a name="d4"></a>
## D4 · Teammates only; Shift Manager and Kitchen Sink follow

The issue names all three apps, and says the signal source differs per app, so it stays at app
level. This spec does Teammates; FIX-2549 carries the other two.

## Decided, not asked

- **Fresh ending window:** two minutes after `completedAt`, read on the row's 30-second clock. A
  task that ended while you were away still shows in the panel; the line is for a glance.
- **Notifications:** off by default; turning it on asks the browser's permission. Stored per
  viewer in browser storage, like unread counts. A notification fires only with the tab hidden,
  once per new need or ending, never for what was already there when the page loaded.
- **Cancelled tasks** don't flash: you or a teammate withdrew them.

## Notes from review

Round 1 (#4717). None changes the approach.

- **One predicate for "needs you" (Cursor):** yes. `status.ts` exports it, and the status line,
  the badge, the title and the notifier all read it. `lib/attention.ts` holds only the title,
  the notifier's once-only rule, the permission and the toggle's storage.
- **Aggregate in `WorkersList` instead of rows reporting up (Cursor):** each row already holds its
  teammate's watches (hooks per row), so the list would have to open them a second time to count.
  The row reports what it read; the list only sums.

Round 2 (#4717), architect follow-up: FIX-2397's status line reads a task's tone and its
*waiting* / *failed* word from `lib/task-state.ts`; only an approval's tone stays in `status.ts`.
Both specs now say so.

## How it got here

- **Drafted (Nov 4).** Stacked on FIX-2395, whose row times the ending line reads.
