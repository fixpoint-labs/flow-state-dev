# FIX-2395 · Decisions

[Spec](SPEC.md) · **Decisions**

<a name="d1"></a>
## D1 · A row's times come from the board's `listTasks` action

| | The action carries them (chosen) | Keep them from the stream's and run's copies, like the brief |
|---|---|---|
| Present after the first board read | yes | only for rows a copy was seen for |
| A task filed before the page loaded | yes | often missing |
| Package change | three optional fields, client read only | none |

- **Because:** the lab's adapter takes every row from the board read (FIX-2429) and keeps only the
  brief, output and error from other copies. Times kept the second way would be missing exactly
  when they matter, for a run that started before you opened the page. The action already carries
  `updatedAt` for clients for the same reason.
- **Locks in:** the model's tool still carries no times (ER-1 is unaffected: these are
  orchestration's own fields, not a lower layer's). Any app on the board action gets them.

<a name="d2"></a>
## D2 · Failed stays open; *Done* shows its newest five

- **Because:** a failure is something to act on, so it shouldn't need a click. Done work is
  history: the newest few answer "what just finished?", and *Show all N* keeps the rest one click
  away, so nothing becomes unreachable. *Cancelled* stays its own collapsed group, as FIX-2525
  decided: a withdrawn task did not fail.
- **Order:** newest first by `completedAt` for ended rows and `startedAt ?? createdAt` for running
  ones; a row with no time keeps its board order after the timed ones. A retry keeps the task's
  first `startedAt`, so a retried task holds its place instead of jumping to the top.
- **Waiting first:** a running task that waits on you sorts to the top of *Running*.

## Decided, not asked

- The failure reason is the row's `error`, cut to one line with `truncate`; the popup has the whole.

## Notes from review

Round 1 (#4717). None changes the approach.

- **Architect cross-spec check:** `lib/task-state.ts` owns a task's tone for the panel row,
  `TaskCard` and FIX-2396's popup; the times on `BoardTask` are this spec's, and FIX-2396's
  duration derives from them. Folded into *What changes*.
- **Nested `BoardTask.times` (Cursor):** kept flat, three optional fields beside the row's other
  flat fields (`spend`, `waiting`); `toBoardTask` is still the one place they're read from the row
  view. FIX-2396 has been told the flat names.
- **The word and tone helper beside `taskLine` in `Popups.tsx` (Cursor):** kept as its own module,
  since three components read it (panel, card, popup) and `Popups.tsx` is FIX-2396's hot file.
  It reads `BoardTask.waiting`, which is FIX-2379's row view; it adds no vocabulary.
- **Where the orchestration check lives (Cursor):** in `list-tasks-spend.test.ts`, beside
  `updatedAt`'s, as the reviewer suggests.

Round 2 (#4717), architect follow-up: FIX-2397's status line reads a task's tone and its
*waiting* / *failed* word from `lib/task-state.ts`; only an approval's tone stays in `status.ts`.
Both specs now say so.

Round 3 (#4717), cross-spec owners settled with FIX-2394 (#4735, its *DECISIONS → Owners, with
#4717*): the running-row clock and the per-state heading counts are FIX-2394's `task-signals`
item; this spec drops its timer and keeps a plain total. D1's row times stay here, and #4735's
clock depends on them. `lib/task-state.ts` still decides tone, including the warning tone for
FIX-2394's `quiet` signal.

Retry start (#4717, #4735, #4724): one start per attempt for durations. FIX-2394's clock and
FIX-2396's popup both time from the row's `run.startedAt`, so a retried row and its popup agree.
The task-level `startedAt` stays on the action as the task's first start: it orders *Running* and
no one reads it as a duration. No `runStartedAt` field is added to `BoardTask`.

## How it got here

- **Drafted (Nov 4):** the issue's *Background* list had already moved to the panel (FIX-2525), so
  the scope is what the panel still lacks.

Round 4 (#4717), Jake 2026-11-05: no `lib/task-state.ts`. The word and tone helper is
`taskRowPresentation(...)` beside `taskLine` in `Popups.tsx`, fed by the `state` / `times`
`toBoardTask` takes from `taskRowView(...)`; this replaces Round 1's own-module answer, and every
`lib/task-state.ts` above now means that helper.
