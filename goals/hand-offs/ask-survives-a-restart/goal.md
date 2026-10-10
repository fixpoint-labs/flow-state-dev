# hand-offs › it ask survives a restart

**Issue:** FIX-1816 (epic FIX-1815, leg a). Its spec's goal: `specs/issues/FIX-1816/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** a worker asks a colleague on its roster and carries on the same turn with the colleague's real answer. A server restart while the turn waits loses nothing, and the colleague's work is filed once.

**Input:** Shift Manager's DevTeam install, served by Shift Manager's own command over a fresh SQLite store. Alice, its owner, hires two workers on the built-in `agent` flow, both on the real model: the colleague, whose instructions alone hold this week's release code word, and the asker. She opens a conversation with the asker, adds the colleague as its delegate, and asks, in the words of `fixtures/ask.json`, for the code word. Held out, picked at run time: the word and both workers' ids. Another wording a person might use must pass too, and so must a kill at another moment while the asker waits.

**Signal:** each failure is tagged.

- `kill:suspended` the server was killed with SIGKILL (the command and every process under it) while the asker's request read `suspended`, as the store left by the dead server shows.
- `a:completed` after the server starts again on the same store, the asker's request, the one that asked, ends `completed`.
- `a:same-turn` the asker's conversation ran that one turn: the answer resumed it, it didn't start another.
- `a:word` that request's own assistant output carries the held-out word.
- `one-row` exactly one row was filed for the colleague, and it is marked asked.
- `b:once` the colleague completed it once: one completed row, one completed run of its task entry.

**Anti-game:** nothing in the runner calls the waker, writes a row or resumes a request. After the restart, the only thing Alice does is call the asker's `listTasks_tasks` every five seconds, as a person looking at the task list would: that is a touch of the board, which is how the product pays what a crash left owed. The kill comes only after the asker's request reads `suspended` in the store. Every grade reads the store file read-only. The word is graded in the asking request's own items, so a later turn can't pass it.

**Model:** real — openai/gpt-5.4-mini (`GOAL_MODEL` overrides), gated on a key that serves it (`keysServing`).

**Run:** `pnpm tsx goals/hand-offs/ask-survives-a-restart/run.mts`. `GOAL_ATTEMPTS=<n>` fresh stores until it first passes (default 3, over the model's flakiness; 1 under a control).

**Controls:** each is a scratch patch to `packages/orchestration/src/tasks/helpers/wait-for-response.ts`, applied as the server loads it (`goals/lib/module-patch.mjs`), printed by the run, and refused when it never reached the code.

- `GOAL_CONTROL=no-run-once`: the ask records neither its filing nor its row's id with `runOnce` (two patches), so the replay after the resume reaches `addTask` with a new id and files again. Must fail **`one-row`**. `b:once` goes red with it (the colleague runs the second row too).
- `GOAL_CONTROL=no-waker`: nothing resumes a waiting turn; a touch of the board finds no owed resume. Must fail **`a:completed`** (the request stays `suspended`). `a:word` goes red with it.

**Before-state:** on `main` before FIX-1816 P3 the asker has no `waitForResponse`, so there is no ask to survive a restart.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-10 | a05519e0c + this goal, uncommitted | openai/gpt-5.4-mini (vercel gateway) | PASS (first run of the script, before the controls) | Killed 5428 ms after the ask, while suspended; one turn, one row (`completed`, 2 attempts), one completed run, "The code word is **lantern4cbd2d**." Run again below after both controls failed |
| 2026-10-10 | a05519e0c + this goal, uncommitted | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `no-run-once`, expected) | Killed 4718 ms after the ask, while suspended. `one-row`: two rows for the colleague, `[completed, 2 attempts]` and `[completed, 1]`; `b:once`: two completed rows in two runs. The asker still ended `completed` with the word, off the second row |
| 2026-10-10 | a05519e0c + this goal, uncommitted | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `no-waker`, expected) | Killed 1338 ms after the ask, while suspended. The colleague's row completed after the restart (2 attempts: the first died with the server), and the asker's request stayed `suspended`: `a:completed`, `a:word` |
| 2026-10-10 | a05519e0c + this goal, uncommitted | openai/gpt-5.4-mini (vercel gateway) | PASS | Attempt 1 of 3. Killed 4088 ms after the ask, while suspended. After the restart the row's lease lapsed, a touch ran it again, it completed, and its notice resumed the asking turn: one turn, one row (`completed`, 2 attempts), one completed run, "The code word is **willowe1b2cd**." |
| 2026-10-10 | f3332a8db (after the review fixes: the notice stays owed until its resume lands; one failed resume stops no touch) | openai/gpt-5.4-mini (vercel gateway) | PASS | Attempt 1 of 3. Killed 4980 ms after the ask, while suspended; one turn, one row (`completed`, 2 attempts), one completed run, "The code word is **copper078ddc**." |
| 2026-10-10 | 9978ffdc4 | openai/gpt-5.4-mini (vercel gateway) | PASS | Attempt 1 of 3. Killed 3942 ms after the ask, while suspended; one turn, one row (`completed`, 2 attempts), one completed run, "The code word is: **lantern4990be**" |
| 2026-10-10 | d4c5f1883 (a router answers for its own sweeper; the answer always comes back) | openai/gpt-5.4-mini (vercel gateway) | PASS | Attempt 1 of 3. Killed 3975 ms after the ask, while suspended; one turn, one row (`completed`, 2 attempts), one completed run, "The code word is: **glacier82a228**" |
| 2026-10-10 | 082693f2e (the ask's id recorded before its row is filed) | openai/gpt-5.4-mini (vercel gateway) | PASS | Attempt 1 of 3. Killed 3897 ms after the ask, while suspended; one turn, one row (`completed`, 2 attempts), one completed run, "The release code word is **heron475661**." |
| 2026-10-10 | 082693f2e | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `no-run-once`, expected) | The control now patches the id's `runOnce` step: the replay files a second row. `one-row`: 2 rows; `b:once`: 2 completed rows in 2 runs |
| 2026-10-10 | f02ff1f58 (old filing key read; deadline counted at filing; the gate's recorded outcome decides) | openai/gpt-5.4-mini (vercel gateway) | PASS | Attempt 1 of 3. Killed 3517 ms after the ask, while suspended; one turn, one row (`completed`, 2 attempts), one completed run, "The code word is **saffron9c747a**." |
| 2026-10-10 | f02ff1f58 | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `no-run-once`, expected) | The re-aimed patch reached the id step: `one-row`, 2 rows; `b:once`, 2 completed rows in 2 runs |
| 2026-10-10 | 5069c0336 (a late answer overrides a timeout only if it came by the deadline) | openai/gpt-5.4-mini (vercel gateway) | PASS | Attempt 1 of 3. Killed 3817 ms after the ask, while suspended; one turn, one row (`completed`, 2 attempts), one completed run. The model printed the word twice in one run-on: "The release code word is: glacierb1d834glacierb1d834", which still carries the held-out word |
| 2026-10-10 | 5069c0336 | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `no-run-once`, expected) | `one-row`, 2 rows; `b:once`, 2 completed rows in 2 runs |
| 2026-10-10 | 5259b2df1 (unique ask ids; no foreign row adopted; a silent cancel read back) | openai/gpt-5.4-mini (vercel gateway) | PASS | Attempt 1 of 3. Killed 4629 ms after the ask, while suspended; one turn, one row (`completed`, 2 attempts), one completed run, "The code word is **copperb725d8**." |
| 2026-10-10 | 5259b2df1 | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `no-run-once`, expected) | `one-row`: 2 rows, both with UUID ids; `b:once`: 2 completed rows in 2 runs |
| 2026-10-10 | c0719a0d6 (the filing recorded under `fsd.ask.file` in the shipped shape again; the control now patches both steps) | openai/gpt-5.4-mini (vercel gateway) | PASS | Attempt 1 of 3. Killed 4304 ms after the ask, while suspended; one turn, one row (`completed`, 2 attempts), one completed run, "The code word is saffron397b9e." |
| 2026-10-10 | c0719a0d6 | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `no-run-once`, expected) | Both patches reached the code: `one-row`, 2 rows; `b:once`, 2 completed rows in 2 runs |
