# teammates-lab › it a worker talks to another while you talk

**Issue:** FIX-2154 (leg b of the FIX-2152 epic's goal); step 5 and the held-out date amended by FIX-2309
**Outcome:** In the Teammates lab, a list-of-workers app on the Grok Bot pattern, you talk to lead, lead messages researcher, and researcher's reply reaches lead while you are still talking to it; lead uses it. A coding job lead hands coder runs through Claude Code in the user's one project, which lead puts its conversation in without asking.
**Input:** held out. The launch date is drawn at random each run and written into the project's README, which researcher reads and lead can't, so lead can only state it by hearing it from researcher. The README's typo is one of several (`fixtures/input.json`). The lines you send are in the fixture.
**Signal:**
- **1:** lead answers your first line in its conversation.
- **2:** a card *To researcher* in lead's conversation, a line *From lead* in researcher's, the exchange under *with researcher* in lead's Talk panel, and a delivered row lead → researcher in the message log.
- **3:** your second line goes in before researcher's reply has landed. The reply shows in lead's conversation under researcher's name, after lead's answer to you, carrying the date; the log holds it as a delivered reply; a line of lead's after it states the date.
- **4:** not run. It needs the history window's mark (G1, FIX-1613); the step waits on it.
- **5:** you ask for the fix. With one project, lead puts its conversation in `relay` and files the task there: no card asks for a project, and the header shows `relay`. The run ends *done in relay*, its steps show Claude Code, and the result lands in lead's conversation from coder. On disk: the checkout's HEAD and working tree are untouched, and exactly one worktree of it, under the lab's runs folder, carries a commit that changes README.md alone, fixing its first line and nothing else.
**Anti-game:** Graded on what the browser shows, the message log read through the public client, and git. Never on the lab's adapter or the server's own state. Lead can't state the launch date without the reply, because it is drawn per run. The disk check reads git, so a run that only says it fixed the typo fails. The step-3 order check reads entry order as drawn, so a reply drawn before lead's answer fails. Each graded list is floored with `tell.over`; an empty log or no worktree counts only where a control produces it, and says so.
**Model:** real — openai/gpt-5.4-mini (lead, researcher, writer); coder's run on Claude Code
**Run:** `pnpm tsx goals/teammates-lab/a-worker-talks-to-another-while-you-talk/run.mts` (needs `AI_GATEWAY_API_KEY`, and Claude Code signed in or `ANTHROPIC_API_KEY`)
**Controls:** each on the same command, failing the steps named and no other:
- `GOAL_CONTROL=no-model`: the workers answer on a model that doesn't exist. Steps 1, 2, 3 and 5 FAIL.
- `GOAL_CONTROL=no-lead-send`: lead's `sendMessage` is dropped from its tools (a scratch patch to `message-tool.ts`). Steps 2 and 3 FAIL. Step 5 may fail too: with no way to message, lead files its research ask as a task for coder, and after the pick it filed nothing again (2 of 2 runs).
- `GOAL_CONTROL=no-reply-tool`: researcher's `sendMessage` is dropped. Step 3 FAILS.
- `GOAL_CONTROL=project-not-kept`: `setWorkProject` answers as kept but stores nothing (a scratch patch to `work-project.ts`), so lead's task has no project and the README never changes. Step 5 FAILS. Step 3 may fail too: researcher can't keep the project it reads the date from.

Steps 2 and 3 have no isolating red state for lead's side: without lead's message there is nothing to reply to, so `no-lead-send` reddens both. Under `no-model` the screen doesn't show your own lines either until a reload: a turn that fails shows nothing live.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-28 | 42fdeb2+ | openai/gpt-5.4-mini, Claude Code | PASS | Steps 1, 2, 3, 5 pass; step 4 not run (FIX-1613). Typo "servce"; date 11 February |
| 2026-10-28 | 42fdeb2+ | openai/gpt-5.4-mini, Claude Code | PASS | Again after scoping step 5 to its own cards. Typo "mesage"; date 26 February; one worktree, README.md only |
| 2026-10-28 | 42fdeb2+ | openai/gpt-5.4-mini | FAIL (expected) | `no-reply-tool`: only [3] "no reply From researcher within 240s" |
| 2026-10-28 | 42fdeb2+ | openai/gpt-5.4-mini | FAIL (expected) | `pick-not-kept`: only [5] "the task filed again ended refused · no project", "0 worktree(s) carry a commit" |
| 2026-10-28 | 42fdeb2+ | openai/gpt-5.4-mini | FAIL (expected) | `no-lead-send`: [2] no card, no Talk group, no log row, no line in researcher's conversation; [3] no reply; [5] lead never filed again after the pick (the run then also flagged 5 as a leak; 5 is now `mayAlso`) |
| 2026-10-28 | 42fdeb2+ | openai/no-such-model-goal-control | FAIL (expected) | `no-model`: [1] no answer (and CAN'T TELL on 1, nothing drawn), [2], [3], [5] all red |
| 2026-10-28 | 920da34+ | openai/gpt-5.4-mini, Claude Code | PASS | After FIX-2289's Markdown entries; the goal reads entries as shown (innerText). Typo "servce"; date 5 May; one worktree, README.md only |
| 2026-10-28 | 7bd40d0+ | openai/gpt-5.4-mini, Claude Code | PASS | Streamed sends. Lead told never to pass `wait`, researcher that only `sendMessage` reaches the asker (earlier runs failed [3] when lead called and when researcher answered in place); step 2 waits for the Talk panel to read the log. Typo "servce"; date 21 April |
