# error-reporter › it files a reproducible issue

**Issue:** FIX-1983
**Outcome:** When something in a Lab fails for good, the operator gets one report in Inbox they can check and add to. Once they answer, the tracker gets one issue an engineer can reproduce from. This holds when the Shift Coordinator is what failed, and when a person reports a problem that threw nothing.
**Input:** The devteam Lab, opened in-process with the Error Reporter on, served over HTTP and read the way Shift Manager reads it (`createLabReader`). A local MCP server stands in for Linear and records every call. The bugs are planted in `plant.mts`, a file the reporter's harness can read:
- the coordinator's model splits an undefined repository when a message names a project with none (Sandbox);
- a worker's harness run throws for `[harness-bug]`, throws once for `[flaky]`, and does nothing for `[gives-up]`;
- a `burst: <word>` message fails with an error naming the word.

The planted failures go to Sandbox's project coordinator. Its routing is `judgment`, so a failure in its turn fails the request. The chief of staff's `best-fit` routing rescues a failure in its own turn into a "Nobody took this post" line, so that request completes and no final failure exists to report (see Verdict log). The trigger is held out: any message that names a project with no repository trips the same bug.
**Signal:**
- **Leg 1.** The message fails the turn. One report reaches Inbox and nothing is filed. Its request, session and user ids equal the store's, in the row and in the draft. The operator answers File with *"Label it P1 and say which model the coordinator ran."* Exactly one issue is filed, and it says P1 and the project coordinator's model. A second Claude Code run, given only the issue, names a worker and message. Sent in a clean Lab, that message trips the same fingerprint.
- **Leg 2.** The same failure 10 more times gives one report with count 11 and no second Inbox card.
- **Leg 3.** In a fresh Lab, 30 different failures give 1 to 5 reports and one storm report, each failure in exactly one.
- **Leg 4.** A task that fails once and passes on retry gives no report.
- **Leg 5.** No report row, report-session record or tracker call holds the Lab's secret, the tracker key or `ANTHROPIC_API_KEY`.
- **Leg 6.** The reporter's own harness fails, so its report stays owed or drafting and the reporter files no report about itself. After a restart with the plant gone, the report is retried and reaches Inbox. Leg 2's count is still 11.
- **Leg 7.** A task that ends errored with no thrown failure gives exactly one report.
- **Leg H.** The bug planted in a worker's harness run gives one report in Inbox, and its link opens the task.
- **Leg M.** A person tells the Error Reporter, in its own conversation, about a problem that threw nothing. One report reaches Inbox and nothing is filed.

**Anti-game:**
- The check never reads the reporter's prompt or the harness transcript to grade. It grades the store's rows, Inbox as Shift Manager reads it, and the tracker's recorded calls.
- A pass with the coordinator healthy proves nothing, so leg 1 first asserts that the message failed the request.
- The replay is graded by fingerprint in a separate Lab, not by text similarity.
- The ids are compared to the store's record for that request, not to anything the report wrote.
- Drafts in leg 1, H, M and the leg 6 retry come from real Claude Code. Only the clean replay Lab, leg 3 and the draft-free controls use a drafting stub, and none of them grades a draft.

**Model:** real. The reporter's harness is Claude Code (Agent SDK, `errorReporterHarness`: Read/Grep/Glob, no writes or shell). The replay is a second Claude Code run. The reporter's conversation turn (leg M) runs its WORKER.md model, `openai/gpt-5.4-mini`, through the AI Gateway. The coordinators' models are the planted ones.
**Run:** `pnpm tsx goals/error-reporter/files-a-reproducible-issue/run.mts` (needs `ANTHROPIC_API_KEY` or `MY_ANTHROPIC_API_KEY`, `AI_GATEWAY_API_KEY`, git)
**Controls:** `GOAL_CONTROL=<name>` on the same command, and `GOAL_CONTROL=list` to print them. Each control patches the product as it loads and runs only the legs it breaks.
- `via-coordinator`: the intake runs on the coordinator's flow. It must FAIL leg 1 on *one report in Inbox*.
- `stack-only`: the issue holds the error alone. It must FAIL leg 1 on *the replay trips the same fingerprint*.
- `skip-preview`: a draft files without waiting. It must FAIL leg 1 on *nothing filed before the answer*.
- `no-dedupe`: one report row per occurrence. It must FAIL leg 2 on *one report*.
- `no-cap`: the new-report cap is off. It must FAIL leg 3 on *at most 5 reports*.
- `eager`: a retried attempt is reported. It must FAIL leg 4 on *no report for a task that passed on retry*.
- `no-redact`: the dossier reaches the harness unredacted. It must FAIL leg 5 on *no secret in a report*.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
