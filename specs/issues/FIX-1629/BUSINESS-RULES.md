# FIX-1629 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

When → then → proved by. CI = unit test in the owning package. VG = the goal check.

## Reading a row

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A board has tasks | One row per task, collapsed. Status comes first; goal (or title) and reason share the rest, one line each, clipped with the full text on hover | CI |
| BR-2 | The window is 1280 wide, panels at default | Status and ≥40px of the reason are in view on every row; the pane does not scroll sideways | VG read |
| BR-3 | A row is clicked, or Enter/Space on it | It expands in place, below itself, inside the pane. No overlay, nothing floats | CI · VG read |
| BR-4 | A row is expanded | Every field the task carries is shown: id, full goal wrapped, title, status, attempts / max, assignee, priority, labels, deps, reason, error, input, output, metadata, revision, created / updated, lease holder, dispatch run, latest change (kind, was, ×N). Absent fields are omitted, not faked | CI · VG read |
| BR-5 | A row is expanded | The raw JSON of the task is available folded inside the row, complete and unchanged | CI |
| BR-6 | A task updates while its row is open | The row stays open and shows the new values | CI |
| BR-7 | A value is huge, markup, or one unbroken token | It wraps or scrolls inside the row; the pane never widens | CI |
| BR-8 | Reason, per FIX-1481 BR-4 / BR-8 | Shown whenever `feedback` is present, whatever the status, verbatim; the slot is absent on a board where no task carries it | CI (existing tests kept) |

## Changing a task from its row

| # | When | Then | Proved by |
|---|---|---|---|
| BR-9 | The viewed flow has public actions whose input requires a string `taskId` | The expanded row lists them | CI · VG answer |
| BR-10 | Such an action's name ends with `_<board suffix>` | It is listed only on that board's rows | CI |
| BR-11 | No action qualifies | The row says so in one line and links the docs on exposing task actions | CI |
| BR-12 | An action is picked | Its form opens in the row with `taskId` filled and locked; other fields as the action bar draws them | CI |
| BR-13 | The action is submitted | It runs through the panel's existing action dispatch against the viewed flow and session; nothing else is called | CI · VG answer |
| BR-14 | It succeeds | The row shows the new state from the change item, without a reload | VG answer · VG tool |
| BR-15 | A tool returns `{ ok: false, error }`, or the request fails | The row shows the refusal or error, in words. Never shown as success | CI · VG refuse |
| BR-16 | Two submits race on one task | Each gets its own verb's answer; the second may be refused. No client-side lock | CI (tool level, existing) |

## The ready-made actions

| # | When | Then | Proved by |
|---|---|---|---|
| BR-17 | A flow spreads `taskToolActions(board)` into `actions` | It gains the eight task tools as actions, named `<tool>_<board suffix>`, each running the same guarded verb a model's tool does | CI |
| BR-18 | One of them targets a settled task, or an illegal move | Refused by the verb, returned as a value | CI |
| BR-19 | A channel declares `boardActions: true` | Each of its boards gets the eight actions. Without it, the channel's public actions are exactly today's | CI |
| BR-20 | `boardActions` is anything but `true`, `false` or absent | Refused at bind, by name, like any other bad value in the closed key list (which grows from six keys to seven) | CI |
| BR-21 | The reference app's `support.help` | Per the open fork | CI · hand check on Jake's screen |

## What none of this may do

| # | Rule | Proved by |
|---|---|---|
| BR-22 | No engine or core route, type or verb is added | Diff review · CI (route table test unchanged) |
| BR-23 | No action claims or drains a board (FIX-1457 ER-1) | CI |
| BR-24 | Nothing Workforce-specific (seats, rosters, channels) enters orchestration, engine or core | Diff review |

## Failure taxonomy

A refused verb is a value on the row. A thrown error or HTTP failure is shown on the row and the
form stays filled for a retry. Nothing is fatal to the panel; a render error in one row must not
blank the tab.

## Acceptance criteria this issue owns

- The goal check passes, and both controls fail at their named legs.
- FIX-1481's `the-checklist-rows` row-4 leg and FIX-1497's VB leg pass against the new row.
- FIX-1523 closes.
