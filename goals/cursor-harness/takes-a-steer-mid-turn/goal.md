# cursor-harness › it takes a steer mid-turn

**Issue:** FIX-2254
**Outcome:** A line sent while a Cursor turn is running joins that turn. The run does the extra
work and carries on with what it was doing, with no second run, no cancel and no new attempt.
This holds in Kitchen Sink's Cursor mode, on a harness manager's task, and while the turn is
waiting on background work.
**Not claimed:** live steering for Claude Code or Codex (follow-up issues); that a line refused by
the run is never lost after a restart (the owed record is in process).
**Input:** `fixtures/input.json`: the model, how many files the slow task writes and the pause
between them. The line names a fresh random token per run, so no answer is known ahead of the run.
**Signal:** Three real Cursor legs, each in a throwaway git repository:
- **k:kitchen-sink** — the `/cursor` session flow driven as the page drives it: a `turn`, then a
  line mid-turn through `sendLine` (the page's own code). Passes when the line was `taken`, there
  was exactly one `turn` request, the turn completed, the turn record's `steered` holds the line,
  `steer-token.txt` holds the token and the last numbered file exists.
- **h:manager** — a harness manager over `cursorAgent`, `steer` on the task mid-step. Passes when
  there was exactly one Cursor run, the task completed on attempt 1, the steer was taken once, and
  the checkout holds `steer-token.txt` with the token.
- **w:waiting** — a turn waiting on a background subagent (`sleep 60`), steered during the wait.
  Passes when the line was sent before `bg-done.txt` existed, was `taken`, and both
  `steer-token.txt` and `bg-done.txt` exist at the end.
**Anti-game:** Graded on files in the worktree, task rows, session state, and counts of runs and
requests, never on what the model says. A line that fell back to a new turn or a stop-and-resume
would still write the token file, so every leg also counts runs or turns: one, not two.
**Model:** real Cursor — `composer-2.5`, on a host with `CURSOR_API_KEY`.
**Run:** `CURSOR_API_KEY=… pnpm tsx goals/cursor-harness/takes-a-steer-mid-turn/run.mts`
**Controls:** `GOAL_CONTROL=no-live-steer` makes no run offer a steer (Kitchen Sink holds no offer;
the manager is built without `onSteerable`). **k**, **h** and **w** must all FAIL.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| — | — | — | NOT YET RUN | No `CURSOR_API_KEY` in the implementing session. CI covers the mechanism: the Cursor block's `onSteerable` tests, `env-fence.spec.ts` (steer across the real child process), the manager's live-steer tests, and Kitchen Sink's parity rows per mode. A real model taking a real line is what remains. |
