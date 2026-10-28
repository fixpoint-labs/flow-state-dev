# teammates-lab › it a worker talks to another while you talk

**Issue:** FIX-2154 (leg b of the FIX-2152 epic's goal)
**Outcome:** In the Teammates lab, a list-of-workers app on the Grok Bot pattern, you talk to lead, lead messages researcher, and researcher's reply reaches lead while you are still talking to it; lead uses it. A coding job lead hands coder runs through Claude Code in the project you picked for lead, and only after you picked it.
**Input:** held out. The launch date researcher knows is drawn at random each run and written into a copy of the workers' tree, so lead can only state it by hearing it from researcher. The README's typo is one of several (`fixtures/input.json`). The lines you send are in the fixture.
**Signal:**
- **1:** lead answers your first line in its conversation.
- **2:** a card *To researcher* in lead's conversation, a line *From lead* in researcher's, the exchange under *with researcher* in lead's Talk panel, and a delivered row lead → researcher in the message log.
- **3:** your second line goes in before researcher's reply has landed. The reply shows in lead's conversation under researcher's name, after lead's answer to you, carrying the date; the log holds it as a delivered reply; a line of lead's after it states the date.
- **4:** not run. It needs the history window's mark (G1, FIX-1613); the step waits on it.
- **5:** lead has no project. You ask for the fix; the task card asks for a project. For 30 s with no pick, no run starts and the checkout is unchanged. You pick `relay` on the card; your pick is said to lead as your line and lead files the task again. That run ends *done in relay*, its steps show Claude Code, the result lands in lead's conversation from coder after your pick. On disk: the checkout's HEAD and working tree are untouched, and exactly one worktree of it, under the lab's runs folder, carries a commit that changes README.md alone, fixing its first line and nothing else.
**Anti-game:** Graded on what the browser shows, the message log read through the public client, and git. Never on the lab's adapter or the server's own state. Lead can't state the launch date without the reply, because it is drawn per run. The disk check reads git, so a run that only says it fixed the typo fails. The step-3 order check reads entry order as drawn, so a reply drawn before lead's answer fails. Each graded list is floored with `tell.over`; an empty log or no worktree counts only where a control produces it, and says so.
**Model:** real — openai/gpt-5.4-mini (lead, researcher, writer); coder's run on Claude Code
**Run:** `pnpm tsx goals/teammates-lab/a-worker-talks-to-another-while-you-talk/run.mts` (needs `AI_GATEWAY_API_KEY`, and Claude Code signed in or `ANTHROPIC_API_KEY`)
**Controls:** each on the same command, failing the steps named and no other:
- `GOAL_CONTROL=no-model`: the workers answer on a model that doesn't exist. Steps 1, 2, 3 and 5 FAIL.
- `GOAL_CONTROL=no-lead-send`: lead's `sendMessage` is dropped from its tools (a scratch patch to `message-tool.ts`). Steps 2 and 3 FAIL.
- `GOAL_CONTROL=no-reply-tool`: researcher's `sendMessage` is dropped. Step 3 FAILS.
- `GOAL_CONTROL=pick-not-kept`: the pick answers as kept but `setWorkProject` stores nothing (a scratch patch to `work-project.ts`), so the task filed again still has no project and the README never changes. Step 5 FAILS.

Steps 2 and 3 have no isolating red state for lead's side: without lead's message there is nothing to reply to, so `no-lead-send` reddens both.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
