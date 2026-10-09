# devtool-workforce-visibility › it works a task from its row

**Issue:** FIX-1629 (absorbs FIX-1523). The spec's goal check (VG).

**Outcome:** A developer opens any task in the DevTool's Tasks tab, reads its whole record in place, changes its state from the same row through the flow's own actions, and sees the result on the row without a reload. On a laptop-width window the parked row's status and reason are in view before anything is opened.

**Input:** The `multi-seat-collab` hire (`packages/shift-manager/test/fixtures/multi-seat-collab/`), with no model, and `fixtures/input.json`: a piece of work with a question only a person can settle, the answer, a spare row to file on the mailbox, and a cancel reason. Both are **held out**. The desk's owning seat, the mailbox, the board's name and the minted ledger id all come off the tree at run time, and every row is found by the id the ledger gave it. A different question, answer, or spare row must pass too.

**Signal:** Chromium on the shipped DevTool bundle, rebuilt at the start of the run, at a **1280×800** window. The lab's driver files the piece and drains over HTTP, so the builder seat parks it by design. After that, every change this goal grades is made from a row on screen. Every failure line names its leg.

- **read.** First the positive record: the ledger holds the row `parked` with a non-empty reason, in a known run. The run is opened from the navigator (kind, seat, the seat's session, the run it spawned) and its Tasks tab is read by task id. Collapsed, the row is not open, its status slot reads `parked`, and its reason slot reads the ledger's reason, with at least 40px of width and one line of height in view after every clipping ancestor and the window. A clamped reason carries the whole text on its title. Opened in place, every field the ledger holds is shown and agrees with the ledger: a field the row has a label for under that label, and any other under its own raw key. A carried empty list reads `none`. Only the fields the ledger never sends to a client (`SERVER_ONLY_TASK_FIELDS`) are left out, and they are noted. Nothing in the row ends past the pane's right edge, and the pane does not scroll sideways.
- **answer.** On the owning seat's own session, the same row, opened, offers the seat's `answer` action. Its form carries the row's task id, locked. The check fills the answer and runs it. The row reports `ok`, the ledger row leaves `parked`, and the row on screen leaves `parked` too. The seats hand rows off, so the row on the seat's session shows the answer's own claim (`in_progress`) while the finish lands in a child run. The check follows the row's own dispatch-run link and requires that run's row to show the ledger's final status.
- **tool.** The driver files a spare row through the mailbox's own `fileTask`, which every mailbox with a board has, opted in or not. On the mailbox's session its row, opened, offers the board's `cancelTask_<board>` tool. Run from the row with a reason, it reports `ok`, the ledger row is `cancelled`, and the row on screen reads `cancelled`.
- **refuse.** The same tool, run again on that now-cancelled row, reports a refusal on the row in the tool's own words, and the ledger row is byte-for-byte unchanged. Graded only when the tool leg's row opened. If it never did, that is the tool leg's failure, and the run notes refuse as ungraded.
- **reload.** The page loads once. Any further main-frame navigation fails.

**Anti-game:** The hollow passes are:

- reading the ledger for what the screen should show;
- finding a row by its text;
- typing a URL, or reloading so a stale screen is replaced;
- a refusal that reads as success;
- an action that ran somewhere other than the row.

So the check never reads the store to decide what is on screen. The ledger is only the thing the screen is graded against. Rows are found by `data-task-id`. The page loads once, and navigation is counted. A refusal must be read as `refused` off the row, with the ledger unchanged. Every action is picked and run from the row's own Actions strip, with the task id already locked in the form. The answer leg's follow-up is the row's own link, not a URL.

**Model:** n/a. The seat bodies are deterministic.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/devtool-workforce-visibility/works-a-task-from-its-row/run.mts`. The run builds the DevTool bundle first. On a clean checkout, run `pnpm --filter @flow-state-dev/devtool build` once before it.

**Controls:** Each control must FAIL at exactly the legs named.

- `GOAL_CONTROL=mailbox-actions-off`: the lab hires its mailbox as if `MAILBOX.md` had not declared `boardActions: true`. Must fail **tool and refuse** only, and the run checks that itself. Read and answer stay green, because the row still opens and the seat's own `answer` is still an action.
- **Today's `main`** (not a flag): the DevTool source from `origin/main`, with this branch's files under `packages/devtool/src` that main does not have removed, rebuilt, and the same command run. Must fail **read, answer and tool**. The rows are a table with no `data-task-id` and no Actions strip. Refuse reports itself ungraded, because its row never opened. Only the DevTool is taken from `main`: `main`'s mailbox binder refuses the lab's `boardActions` key, so a whole-`main` server would not start and would grade nothing.

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-28 | `1f2bc1183` (on `fix/fix-1629`, over `main` at `15087779`) | n/a | **PASS** | Every leg green at 1280×800. **read:** the builder seat's run showed the row `parked`, with 92px of its reason in view. Open, the 13 ledger fields the row has a place for were shown and agreed with the ledger, and nothing ran past the pane. `leaseDurationMs`, `claimedBy`, `writeLogTruncated` and `incarnationId` are raw-JSON only. **answer:** `answer` was run from the row with the id locked. The ledger went to `completed`. The row on the seat's session read `in_progress` (the answer's own claim), and the run its link opened read `completed`. **tool:** `cancelTask_eng_queue_work` was run from the mailbox's row. Ledger and row both read `cancelled`. **refuse:** the same tool, run on that row again, showed *"Refused: terminal_task_write_declined: … is cancelled, which is terminal …"*, and the ledger was unchanged. One page load. Run twice, and once more with a swapped fixture (a different question, answer and spare row), and all three passed. |
| 2026-09-28 | `1f2bc1183` (control: `mailbox-actions-off`) | n/a | FAIL (expected) | **tool and refuse only**: *"the mailbox's row offers [], not the board's `cancelTask_eng_queue_work`"*, and the same for refuse. Read and answer stayed green. |
| 2026-09-28 | `1f2bc1183` with `packages/devtool/src` from `origin/main` (control: today's `main`) | n/a | FAIL (expected) | **read, answer and tool**: no row carries a task id, so none was found by one. Refuse was noted ungraded, because its row never opened. Restored with `git checkout HEAD -- packages/devtool/src` and rebuilt. |
| 2026-09-28 | `b8ad96ff` (PR review round 1: exact board match, final root trace, declined writes, concurrent dispatch) | n/a | **PASS** | Every leg green at 1280×800: the parked row showed 92px of its reason, 13 ledger fields matched open, `answer` left the row `in_progress` with its run `completed`, `cancelTask_eng_queue_work` cancelled ledger and row, and the second run showed *"Refused: terminal_task_write_declined: …"* with the ledger unchanged. One page load. |
| 2026-09-28 | `b8ad96ff` (control: `mailbox-actions-off`) | n/a | FAIL (expected) | **tool and refuse only**: *"the mailbox's row offers [], not the board's `cancelTask_eng_queue_work`"*. Read and answer stayed green. Today's-`main` control not re-run: this round changed nothing it depends on. |
| 2026-09-28 | PR review round 6 (over `b3f74ea5d`: read grades every carried field; outcome skips lifecycle-hook roots) | n/a | **PASS** | Every leg green at 1280×800. **read:** all 16 ledger fields a client is sent were shown and matched, including `leaseDurationMs`, `writeLogTruncated` and `incarnationId` under their raw keys. `claimedBy` is server-only and noted. Answer, tool and refuse as before. Run twice. |
| 2026-09-28 | same, with the row's catch-all for unlabelled fields removed (negative, not committed) | n/a | FAIL (expected) | **read only**: *"the open row does not show leaseDurationMs, writeLogTruncated, incarnationId, which the ledger holds"*. Restored and rebuilt. |
| 2026-10-09 | fix/FIX-1824-goals-one-copy on 9d136d21a, before the fix | n/a | FAIL | Red on `main` since FIX-1788 P4, before any leg: *"locator.click: Timeout 30000ms exceeded … waiting for locator('[data-session-id="s_eng_builder"]')"*. The navigator was opened on an instance named for the seat, which no longer exists: the seat's session is on the one `worker` copy. |
| 2026-10-09 | fix/FIX-1824-goals-one-copy on 9d136d21a | n/a | **PASS** | The navigator opens the one `worker` copy (a copy's id is its kind) and the seat's session under it. Every leg green at 1280×800: the parked row collapsed shows `parked` and 92px of its reason; open, all 17 ledger fields a client is sent shown and matching; `answer` run from the row; `cancelTask_eng_queue_work` cancelled ledger and row; the second run refused as terminal with the ledger unchanged. |
| 2026-10-09 | same (control: `mailbox-actions-off`) | n/a | FAIL (expected) | **tool and refuse only**: *"the mailbox's row offers [], not the board's `cancelTask_eng_queue_work`"*, and the same for refuse. The today's-`main` control was not re-run: it compares against a DevTool from before FIX-1629, which this change does not touch. |
