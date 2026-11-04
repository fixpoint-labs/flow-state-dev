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
  ones; a row with no time keeps its board order after the timed ones.
- **Waiting first:** a running task that waits on you sorts to the top of *Running*.

## Decided, not asked

- The elapsed time uses the lab's `age` format (`now`, `5m`, `2h`), ticking on the panel's clock,
  and stops while the feed is stale, as the status line's age does.
- The failure reason is the row's `error`, cut to one line with `truncate`; the popup has the whole.

## How it got here

- **Drafted (Nov 4):** the issue's *Background* list had already moved to the panel (FIX-2525), so
  the scope is what the panel still lacks.
