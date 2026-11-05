# teammates-lab › it stops and re-runs a task from its popup

**Issue:** FIX-2382

**Outcome:** In the Teammates lab, a person opens a running coding task's popup and steers it, cancels it, and re-runs it on another harness, by clicks, with no model turn in between. The words reach the run, the run stops, and the re-run is one new task on the other worker that keeps the old brief, names the task it re-runs, and reports back to Chief of Staff's conversation. Pressing Re-run on the same harness again shows the board's own refusal and files nothing. Chief of Staff, woken by the cancel and the result, files nothing of its own.

**Input:** `fixtures/input.json`: one coding task (title, goal and context) filed on `teammates.cursor` from Chief of Staff's conversation through the board's `createTask_tasks`, the worker to re-run on (`teammates.claude-code`, shown as *Claude Code*), and nothing else: a control re-runs into a second conversation with Chief of Staff, which every run opens. The steer's words are fresh per run. **Held out:** nothing in the lab names the task, its brief or the steer.

**Signal:** `fsdev dev --app <pages>` on a fresh store over a git checkout holding one commit, the pages built from a scratch copy of the lab's source. The coding workers run on the lab's scripted harness (`GOAL_HARNESS=stub`, harness-manager's `scriptedHarness`), its five steps 6 s apart, so no coding model is needed. Chromium opens Chief of Staff's panel, clicks the task's row, and presses the popup's buttons. Every grade reads the board's rows (`listTasks_tasks`, and `getTask_tasks` for a row's steers and context) and the run's requests through the public client. The page is read only for the action row's outcome or refusal line.

- `steer`: within 10 s of the press, the row's steers hold the words typed.
- `cancel`: Cancel, then Yes. Within 10 s the row reads `cancelled`. The run session's request leaves `in_progress` within one steer poll plus slack (`STEER_POLL_MS` + 5 s) of the press, and the run says no further step over the next two step intervals.
- `re-run`: *Re-run on Claude Code*. Exactly one new row across the boards of both conversations with Chief of Staff, on `teammates.claude-code`, with the old goal, and its context the old context, a blank line, and a line naming the old task by title. The old row's status, brief, attempts and steers are unchanged.
- `re-run again`: the same button again. The action row shows the board's refusal, starting `already_open: `, and no board gains a row.
- `result`: the re-run waits for its review (the scripted run commits), is accepted through the Inbox client as the popup's Accept would, completes, and Chief of Staff's conversation holds the board's notice of its ending (`parseNotice(item).taskId`).
- `cos-files-nothing` (E8): once Chief of Staff's woken turns have ended, its board holds the old task and the re-run, and no other row.

**Anti-game:** No assertion reads the page beyond the action row's outcome or refusal line; a button that only looks pressed fails every row read. The steer is graded on the row, not on the box clearing. *Cancel* is graded on the run's request as well as the row, so a row marked cancelled over a run that keeps working fails. *Re-run* reads every board a re-run could land on, so one filed twice or on the wrong worker fails, and *result* reads Chief of Staff's own conversation, so a re-run filed on another conversation's board fails there. *re-run again* needs the board's own word, `already_open`, not any refusal.

**Model:** real, for Chief of Staff's woken turns (the lab's default, `openai/gpt-6-luna`) and the run's judge (`goalJudge`'s default). The coding runs are scripted, and no leg waits on what a model says.

**Shared:** the lab's boot is `goals/teammates-lab/lab.mts`.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/teammates-lab/stops-and-re-runs-a-task-from-its-popup/run.mts`. It needs `AI_GATEWAY_API_KEY`.

**Controls:** on the same command; each patch lands in the scratch copy the pages are built from, and is printed.

- `GOAL_CONTROL=wrong-board`: the adapter's task actions are bound to board `"plan"` instead of the conversation's `"tasks"`. Every leg must FAIL: `steer`, `cancel`, `re-run`, `re-run again`, `result` and `cos-files-nothing` (nothing was re-run, so the board doesn't hold one).
- `GOAL_CONTROL=other-session`: Re-run is bound to a second conversation with Chief of Staff (opened in every run, so it has a board of its own) instead of the one that filed the task. `result` must FAIL (its notice lands in the second conversation), and so does `cos-files-nothing` (the filing conversation's board doesn't hold the re-run). `steer`, `cancel`, `re-run` and `re-run again` pass.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-04 | 55d640fe + this goal, pre-commit | openai/gpt-6-luna (Chief of Staff's woken turns), goalJudge default (judge); scripted harness | control `wrong-board`: FAIL as required | Every leg red. `steer` and `cancel` show a refusal (`Request failed (500)`: the flow has no `updateTask_plan`), the row stays `in_progress` and its run's request is still running 11.2 s after the press. No Re-run is offered, so `re-run`, `re-run again`, `result` and `cos-files-nothing` fail |
| 2026-11-04 | same, before the cancel bound was measured from the press | same | control `other-session`: FAIL as required | `result`: Chief of Staff's conversation has no notice of the re-run, which was filed on the second conversation's board. `cos-files-nothing`: the filing board doesn't hold the re-run. `steer`, `cancel` (run stopped 1.6 s after the press), `re-run` and `re-run again` passed |
| 2026-11-04 | 55d640fe + this goal, pre-commit | same | PASS | The steer reached the row. Cancel: the run's request ended 1.25 s after the press, with no step after it. One re-run on `teammates.claude-code`, carrying the old context plus the line naming the old task. A second press showed `already_open`. The re-run's review was accepted, it completed, and its notice is in Chief of Staff's conversation. The board holds 2 rows |
