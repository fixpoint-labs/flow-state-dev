# workforce-apps › they draw a conversation's lines from the registry, configured

**Issue:** FIX-2852

**Outcome:** Teammates and Shift Manager draw a worker's conversation from the UI registry's `conversation-lines` and `workforce-lines` items, configured by each app's own line context, and each keeps what is its own. In Teammates the lines between workers carry each worker's avatar, a sent line and a result line open their popups, a failed turn offers Retry, and a filed task is its live card, read from the board. In Shift Manager a failed turn offers Retry and a line between workers links to Messages. Both draw a stopped turn, a sent and a received message, a filed task and its ending, and a tool call as steps.

**Input:** one Lab, `lab.config.mts`: the Teammates lab's own host on its own workers, with only the model scripted. Teammates serves it with `fsdev dev --config`, Shift Manager with its command's `--config`, each on a fresh store over an empty git checkout. The run plays the same conversation with Chief of Staff in each, through the public client, in this order: a message to researcher, whose answer comes back as a message; a task filed for researcher, which it ends in words; a tool call (`listRoutines`); a turn stopped mid-way; and last a turn that fails, so its Retry is the newest turn's. **Held out:** no app source names the workers' lines or the asks.

**Signal:** Chromium opens the conversation in each app (Teammates by the worker in its list, Shift Manager at `/s/<session>`) and reads the page: the `data-line` of each registry line (`failed`, `stopped`, `sent`, `received`, `task`, `result`, `steps`), Retry on the failed line, Teammates' `[data-avatar]` on the sent and received lines, its task card (`data-entry=task`) and the status it reads from the board, a dialog opening on a click of the sent and the result line, and Shift Manager's `messages-link` and tool group.

**Anti-game:** every check reads the live page, after real turns on the real host, with only the model scripted. Each app is built from a copy of its source (never the committed pages), so the run grades the tree. The card's "done" is the board's word, never the filing's. A check that never ran is red.

**Model:** none: the model is scripted (`labs/test-support/contract.ts`), every tool runs for real.

**Kitchen Sink is not run.** It has no line of its own left to prove: its failed turn stays its own until FIX-2853, and it sets no line context. Its registry copies are held byte-equal by its drift test (`apps/kitchen-sink/test/registry-drift.test.ts`), and its registry wiring is typechecked. A page check would need its production Next build, whose package step runs through turbo, which fails in this environment ("Exec format error"), and a host that scripts its workers, which its test mode's scripted model doesn't.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/workforce-apps/configured-lines/run.mts`. It builds both apps' pages itself, into the run's scratch folder. About two minutes.

**Controls:** `GOAL_CONTROL=no-line-context` on the same command. It patches each app's `src/components/Conversation.tsx` in its scratch copy so its `LineContext.Provider` is handed an empty value (printed as `patched:`). It must fail exactly `t:failed`, `t:avatar`, `t:opens-sent`, `t:opens-result` and `s:failed`, with every other check green; anything else is reported as `WRONG:`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-20 | fix-2852-impl + this goal | scripted | PASS | All 18 checks PASS. Teammates: 1 failed line with Retry, 1 stopped, 1 sent, 1 received, card status "done", 1 result, 1 steps line, 2 avatars on the sent and received lines; the sent line opened "Messaged researcher", the result line "Asked researcher to fix the README typo". Shift Manager: 1 each of failed (with Retry), stopped, sent, received, task, result, 1 tool group, 2 Messages links |
| 2026-11-20 | fix-2852-impl + this goal | scripted | FAIL (expected) | `no-line-context`: t:failed ("0 Retry"), t:avatar ("0 avatar(s)"), t:opens-sent and t:opens-result ("no line is a button"), s:failed ("0 Retry") red; every other check green |
