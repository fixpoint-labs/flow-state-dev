# task-board › it refuses a board built wrong

**Issue:** FIX-2076 (epic FIX-2056), leg b. Its spec's goal: `specs/issues/FIX-2076/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** whether a board's drain waits on its rows is the author's declared choice. A board whose declaration contradicts its assignees, and a goal-seek loop over a board whose drain can return with work unfinished, fail when they are built, and the error says which setting is wrong and what to write instead. Nothing runs first.

**Input:** six boards as an author would write them, built through the public `taskBoard()` and `goalSeekLoop()`:

- a plan board (the default) whose dispatcher says `wait: false` (since FIX-2082 a plan board may hold a dispatcher, and waits on the rows it hands over);
- a delegation board whose dispatcher says `wait: true`;
- a delegation board with an assignee that runs inline;
- a delegation board with no dispatcher;
- a goal-seek loop over a delegation board;
- a board that still sets `onReview`, the option FIX-2131 removed (it was the loop-over-a-park-exit case before: with no parked status a drain no longer returns with a row parked, so the loop's guard went with it).

Held out: each board's names are arbitrary, and the check reads only the error the build throws. Beside them, the same boards declared right must build.

**Signal:** each failure is tagged `b:<assertion> · <board>`.

- `b:refused` the build throws.
- `b:names-the-setting` the message names what contradicts what (the board's mode and the assignee, the loop and the board's mode, or the removed `onReview`).
- `b:names-the-fix` the message gives the change to make (`mode: "delegation"`, a dispatcher or drop `mode`, a plan board, remove `onReview`).
- `b:right-builds` a delegation board with only a dispatcher, a plan board whose dispatcher leaves `wait` to the mode, and a goal-seek loop over a plan board, build.

**Anti-game:** the check builds through the public factories and reads the thrown message, never the internal assertion functions. Each case names its own setting and fix, so a refusal that fires for another reason (the boardId check, the backing check) fails `b:names-the-setting`. The right-built pair keeps a fence that refuses everything from passing.

**Model:** n/a

**Run:** `pnpm tsx goals/task-board/refuses-a-board-built-wrong/run.mts`

**Controls:** `GOAL_CONTROL=no-fence` skips the mode check in `taskBoard()`, the loop's guard and the `onReview` refusal, as today's `main` has none (a scratch patch applied as the process loads, `goals/lib/module-patch.mts`). It must fail **`b:refused`** for all six boards.

FIX-2080's refusal of a plan row filed held joins this leg when that issue lands: this one landed first, so the leg holds five refusals.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-21 | fix/FIX-2076, uncommitted goal | n/a | PASS | 5 boards refused at build, each naming its setting and fix; the right-built pair built |
| 2026-10-21 | fix/FIX-2076, uncommitted goal | n/a | FAIL (control `no-fence`, expected) | `b:refused` for all five: each built with no refusal |
| 2026-10-22 | fix/FIX-2082 13088b0a5 | n/a | PASS | 6 boards refused at build, each naming its setting and fix; the plan board now holds a dispatcher that won't wait, and a delegation board whose dispatcher waits is new |
| 2026-10-22 | fix/FIX-2082 13088b0a5 | n/a | FAIL (control `no-fence`, expected) | `b:refused` for all six: each built with no refusal |
| 2026-10-26 | `fix/fix-2131` on `f32747683`, uncommitted | n/a | PASS | 6 boards refused at build; the sixth is now a board that still sets the removed `onReview`, refused by name with *Remove the option*. |
| 2026-10-26 | same (control `no-fence`) | n/a | FAIL (expected) | `b:refused` for all six. |
