# Census · every retired Workforce term, counted and classified

The factual base of [FIX-1796](../../SPEC.md) and the shape of its goal check, re-derived by a
script rather than counted by hand. Not production code; outside default discovery
([specs/README.md](../../../../README.md)). The last implementation PR moves it to
`scripts/check-retired-terms.mjs` ([PLAN](../../PLAN.md) S10).

## How to run it

```bash
node specs/issues/FIX-1796/poc/term-census/check.mjs              # the census; exits 1 while any line is unswept
node specs/issues/FIX-1796/poc/term-census/check.mjs --list seat  # every unswept line of one term
node specs/issues/FIX-1796/poc/term-census/check.mjs --control    # must print CONTROL PASS
```

It reads every tracked file. **Totality, twice:** each file falls in exactly one area, in scope
or kept (history, process, `goals/`, root configuration), or the run fails naming it; and each
match of a retired term on an in-scope line is either stripped by a named exception or counted
as unswept. Exceptions strip a token, never a line, so a second retired word on the same line
still counts; a stored key strips alone, never the rest of the quoted literal it opens. An
exception that strips nothing fails the run.

**Ground is a surface, not a folder.** "Kind", "owner pin", "flow instance", "member" and
"thread" are scanned on Workforce's ground only: its own packages and pages, plus any file that
imports Workforce or Shift Manager, wherever it sits (kitchen-sink's seat pane, the React
panels). The task board keeps "seat" ([D1](../../DECISIONS.md#d1)): its named types
(`TaskSeat…`, `HandOffSeat`, the tool-seat names) strip anywhere, and its bare word strips only
in the board's own files, a closed list that fails the run if one of them is on Workforce's
ground. "Hired seat" counts everywhere.

`--control` adds, in memory, three planted files and one unscoped folder. Each planted line hides
a retired word behind an exception that covers its neighbour, and each must be refused:

| Plant | Must count |
|---|---|
| "the agent kind" beside `flowKind` and "kind of" | kind |
| "the mailbox" beside `MAILBOX.md … WORKER.md` | mailbox |
| "each seat" beside the stored name `"inventory/seats/x"` | seat |
| `"inventory/seats/x belongs to this mailbox"`, two terms in one quote | mailbox |
| `roomLineSchema`, a lower-camel identifier | room |
| "wakeMemberWorkers remembers the thread" | member, thread |
| `TaskSeat` beside "the seat this pane opens", in a kitchen-sink file that imports Workforce | seat |
| "the worker's kind" in that same file | kind |
| "a dispatcher seat hands this row to a hired seat", in a board file | seat |
| a file in a folder no area names | totality |

## What was observed

On `cad4e2780`, with this spec's own files tracked: **FAIL**, as it must before the sweep. 5,802
tracked files, every one with an area; 22,627 unswept lines in 650 files.

| Term | Lines | Files | Unswept lines |
|---|---|---|---|
| seat | 9,989 | 460 | 9,614 |
| mailbox | 5,774 | 266 | 5,738 |
| kind (Workforce ground) | 4,367 | 275 | 3,296 |
| member (Workforce ground) | 1,407 | 158 | 1,378 |
| room | 930 | 70 | 880 |
| person | 898 | 289 | 898 |
| talk session | 298 | 37 | 298 |
| hired roster | 282 | 55 | 279 |
| flow instance (Workforce ground) | 348 | 102 | 129 |
| owner pin (Workforce ground) | 111 | 26 | 111 |
| thread (Workforce ground) | 10 | 7 | 6 |

By folder: `workforce`, `shift-manager` and `kitchen-sink` hold most of it, then `orchestration`,
`engine`, the Workforce docs, then a long tail. The exceptions stripped 1,329 field names called
`kind`, 274 bare board seats in the board's own files and 104 board type names, 225 uses of
core's `FlowInstance` type, 172 stored names (D2), 38 "a kind of", 33 "room for", 24 discovery
domain names, 15 `MAILBOX.md` beside `WORKER.md`, 14 project and org members, 4 chat threads, 3
other kinds. None strips nothing.

The run also names one board file on Workforce's ground: the task-board page's "A board a mailbox
holds" section imports Workforce. That section goes with the mailbox (FIX-1792); if it hasn't,
the sweep moves it to the Workforce pages rather than widening the board's list.

"Member" counts project members' `isMember` and a coding harness's `thread:` option today; those
are the implementer's exceptions to pin, one token at a time.

`--control`: **CONTROL PASS**, all ten plants and the folder refused.

**Before this round** the same commit read 21,436 unswept lines in 661 files. The difference is
the fold: board seats no longer count (D1), "member", "thread" and lower-camel `room…` names now
do, Workforce's ground now reaches the files that import it, and a stored key no longer hides
the rest of its literal.

Most of today's lines are in code the other children rewrite or remove first, so these are a
baseline, not the sweep's size: re-run on the build commit.
