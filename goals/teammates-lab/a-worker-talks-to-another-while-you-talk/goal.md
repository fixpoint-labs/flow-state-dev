# teammates-lab › it a worker talks to another while you talk

**Issue:** FIX-2154 (leg b of the FIX-2152 epic's goal), step 4 with FIX-1613
**Outcome:** In the Teammates lab, a list-of-workers app on the Grok Bot pattern, you talk to lead, lead messages researcher, and researcher's reply reaches lead while you are still talking to it; lead uses it. Long after both have left lead's history window, lead still knows them, and the screen shows where its word-for-word reading begins. A coding job lead hands coder runs through Claude Code in the project you picked for lead, and only after you picked it.
**Input:** held out. The launch date researcher knows is drawn at random each run and written into a copy of the workers' tree, so lead can only state it by hearing it from researcher. Step 4's codename (a colour, an animal and a number) is drawn per run, and its 60 lines are shuffled. The README's typo is one of several (`fixtures/input.json`). The lines you send are in the fixture.
**Signal:**
- **1:** lead answers your first line in its conversation.
- **2:** a card *To researcher* in lead's conversation, a line *From lead* in researcher's, the exchange under *with researcher* in lead's Talk panel, and a delivered row lead → researcher in the message log.
- **3:** your second line goes in before researcher's reply has landed. The reply shows in lead's conversation under researcher's name, after lead's answer to you, carrying the date; the log holds it as a delivered reply; a line of lead's after it states the date.
- **4:** you tell lead a codename, then send 60 more lines, past the 50-turn history window, each answered before the next. Then you ask for the codename and the launch date. lead's answer holds all three words of the codename and the date, and lead sent researcher nothing new for it (no new card, no new log row). The conversation shows a divider labelled *Earlier turns summarized*, and both the codename line and researcher's reply are drawn above it.
- **5:** lead has no project. You ask for the fix; the task card asks for a project. For 30 s with no pick, no run starts and the checkout is unchanged. You pick `relay` on the card; your pick is said to lead as your line and lead files the task again. That run ends *done in relay*, its steps show Claude Code, the result lands in lead's conversation from coder after your pick. On disk: the checkout's HEAD and working tree are untouched, and exactly one worktree of it, under the lab's runs folder, carries a commit that changes README.md alone, fixing its first line and nothing else.
**Anti-game:** Graded on what the browser shows, the message log read through the public client, and git. Never on the lab's adapter or the server's own state. Lead can't state the launch date without the reply, because it is drawn per run. The disk check reads git, so a run that only says it fixed the typo fails. The step-3 order check reads entry order as drawn, so a reply drawn before lead's answer fails. Step 4 counts lead's messages to researcher around the question, so asking researcher again for the date fails, and it reads which side of the divider each fact sits on, so a fact still read word for word doesn't count. Each graded list is floored with `tell.over`; an empty log or no worktree counts only where a control produces it, and says so.
**Model:** real — openai/gpt-5.4-mini (lead, researcher, writer); coder's run on Claude Code
**Run:** `pnpm tsx goals/teammates-lab/a-worker-talks-to-another-while-you-talk/run.mts` (needs `AI_GATEWAY_API_KEY`, and Claude Code signed in or `ANTHROPIC_API_KEY`)
**Controls:** each on the same command, failing the steps named and no other:
- `GOAL_CONTROL=no-model`: the workers answer on a model that doesn't exist. Steps 1, 2, 3 and 5 FAIL.
- `GOAL_CONTROL=no-lead-send`: lead's `sendMessage` is dropped from its tools (a scratch patch to `message-tool.ts`). Steps 2 and 3 FAIL. Step 5 may fail too: with no way to message, lead files its research ask as a task for coder, and after the pick it filed nothing again (2 of 2 runs).
- `GOAL_CONTROL=no-reply-tool`: researcher's `sendMessage` is dropped. Step 3 FAILS.
- `GOAL_CONTROL=pick-not-kept`: the pick answers as kept but `setWorkProject` stores nothing (a scratch patch to `work-project.ts`), so the task filed again still has no project and the README never changes. Step 5 FAILS.
- `GOAL_CONTROL=no-summary`: the history summary's capability and fold are dropped from the lab's host (a scratch patch to `host.mts`); memory stays. Step 4 FAILS: the divider can't say *summarized*.
- `GOAL_CONTROL=no-memory`: the summary and memory are both dropped from the host. Step 4 FAILS: nothing holds what left the window.

Step 4 is skipped under `no-model`, `no-lead-send`, `no-reply-tool` and `pick-not-kept`: its 60 lines test nothing about the step each control reddens.

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
| 2026-10-28 | aace8e4+ | openai/gpt-5.4-mini, Claude Code | FAIL | Step 4 only: the fold stored the summarizer's `summary` and dropped its `keyPoints`, where the date went (fixed in FIX-1613, 6693940); a codename filed as a standing rule (now a fail of its own) |
| 2026-10-28 | bb004bc+ | openai/gpt-5.4-mini, Claude Code | FAIL | Step 4 only: the second fold rewrote the summary from the newer turns and lost the launch facts; the lab's summarizer objectives now say its summary replaces the one so far |
| 2026-10-28 | 068ae50 | openai/gpt-5.4-mini, Claude Code | PASS | Steps 1 to 5. Step 4: "cobalt walrus 608" and 17 September after 60 lines; 4 folds, both facts in the stored summary; divider "Earlier turns summarized" below both |
| 2026-10-28 | 068ae50 | openai/gpt-5.4-mini | FAIL (expected) | `no-summary`: [4] "I don't have that information", divider "Earlier turns out of view". A first run also reddened [3]: researcher answered in its own conversation, not with `sendMessage` |
| 2026-10-28 | 068ae50 | openai/gpt-5.4-mini | FAIL (expected) | `no-memory`: [4] neither fact, divider "Earlier turns out of view"; [3] red the same way as above |
| 2026-10-28 | a2caae9+ | openai/gpt-5.4-mini, Claude Code | PASS | Steps 1 to 5 after FIX-2289's Markdown entries, entries read as laid out. Step 4: "umber badger 214" and 4 December |
| 2026-10-28 | 14fa6b0 | openai/gpt-5.4-mini, Claude Code | FAIL | Step 4 only, a read too early: lead answered "crimson walrus 846" and 22 May, but with FIX-2289's streamed answers "is answering" cleared before the answer's last words were drawn, and the goal read "…and the". The goal now waits for the drawn answer to settle |
| 2026-10-28 | 00e8f07 | openai/gpt-5.4-mini, Claude Code | PASS | Steps 1 to 5 with streamed answers, the answer read once drawn in full. Step 4: "cobalt gecko 377" and 22 February; divider "Earlier turns summarized" below both |
