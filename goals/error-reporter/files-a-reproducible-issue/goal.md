# error-reporter › it files a reproducible issue

**Issue:** FIX-1983
**Outcome:** When something in a Lab fails for good, the operator gets one report in Inbox they can check and add to. Once they answer, the tracker gets one issue an engineer can reproduce from. This holds when the Shift Coordinator is what failed, and when a person reports a problem that threw nothing.
**Input:** The devteam Lab, opened in-process with the Error Reporter on, served over HTTP and read the way Shift Manager reads it (`createLabReader`). A local MCP server stands in for Linear and records every call. The bugs are planted in `plant.mts`, a file the reporter's harness can read:
- the coordinator's model splits an undefined repository when a message names a project with none (Sandbox);
- a worker's harness run throws for `[harness-bug]`, throws once for `[flaky]`, and does nothing for `[gives-up]`;
- a `burst: <word>` message fails with an error naming the word.

Most planted failures go to Sandbox's project coordinator. Its routing is `judgment`, so a failure in its turn fails the request. Leg C sends them to the Shift Coordinator: its `best-fit` routing answers a crash in its own turn with "Nobody took this message", and the request completes. The trigger is held out: any message that names a project with no repository trips the same bug.
**Signal:**
- **Leg 1.** The message fails the turn. One report reaches Inbox and nothing is filed. Its request, session and user ids equal the store's, in the row and in the draft. The operator answers File with *"Label it P1 and say which model the coordinator ran."* Exactly one issue is filed, and it says P1 and the project coordinator's model. A second Claude Code run, given only the issue, names a worker and message. Sent in a clean Lab, that message trips the same fingerprint.
- **Leg 2.** The same failure 10 more times gives one report with count 11 and no second Inbox card.
- **Leg 3.** In a fresh Lab, 30 different failures give 1 to 5 reports and one storm report, each failure in exactly one.
- **Leg 4.** A task that fails once and passes on retry gives no report.
- **Leg 5.** No report row, report-session record or tracker call holds the Lab's secret, the tracker key or `ANTHROPIC_API_KEY`.
- **Leg 6.** The reporter's own harness fails, so its report stays owed or drafting and the reporter files no report about itself. After a restart with the plant gone, the report is retried and reaches Inbox. Leg 2's count is still 11.
- **Leg 7.** A task that ends errored with no thrown failure gives exactly one report.
- **Leg H.** The bug planted in a worker's harness run gives one report in Inbox, and its link opens the task.
- **Leg C.** In a fresh Lab, the Shift Coordinator's own turn crashes on the planted bug and best fit answers it; its report reaches Inbox. Then the Shift Coordinator hands a post to an agent worker, `researcher`, whose turn fails on it; that post's report reaches Inbox.
- **Leg M.** A person tells the Error Reporter, in its own conversation, about a problem that threw nothing. One report reaches Inbox and nothing is filed.

**Anti-game:**
- The check never reads the reporter's prompt or the harness transcript to grade. It grades the store's rows, Inbox as Shift Manager reads it, and the tracker's recorded calls.
- A pass with the coordinator healthy proves nothing, so leg 1 first asserts that the message failed the request.
- The replay is graded by fingerprint in a separate Lab, not by text similarity.
- The ids are compared to the store's record for that request, not to anything the report wrote.
- Drafts in leg 1, H, M and the leg 6 retry come from real Claude Code. Only the clean replay Lab, leg 3 and the draft-free controls use a drafting stub, and none of them grades a draft.

**Model:** real. The reporter's harness is Claude Code (Agent SDK, `errorReporterHarness`: Read/Grep/Glob, no writes or shell). The replay is a second Claude Code run. The reporter's conversation turn (leg M) runs its WORKER.md model, `openai/gpt-5.4-mini`, through the AI Gateway. The coordinators' models are the planted ones. In leg C, the researcher's turn on the `[post-bug]` post is planted to throw; leg C drafts with the stub.
**Run:** `pnpm tsx goals/error-reporter/files-a-reproducible-issue/run.mts` (needs `ANTHROPIC_API_KEY` or `MY_ANTHROPIC_API_KEY`, `AI_GATEWAY_API_KEY`, git)
**Controls:** `GOAL_CONTROL=<name>` on the same command, and `GOAL_CONTROL=list` to print them. Each control patches the product as it loads and runs only the legs it breaks.
- `via-coordinator`: the intake runs on the coordinator's flow. It must FAIL leg 1 on *one report in Inbox*.
- `stack-only`: the issue holds the error alone. It must FAIL leg 1 on *the replay trips the same fingerprint*.
- `skip-preview`: a draft files without waiting. It must FAIL leg 1 on *nothing filed before the answer*.
- `no-dedupe`: one report row per occurrence. It must FAIL leg 2 on *one report*.
- `no-cap`: the new-report cap is off. It must FAIL leg 3 on *at most 5 reports*.
- `eager`: a retried attempt is reported. It must FAIL leg 4 on *no report for a task that passed on retry*.
- `no-redact`: the dossier reaches the harness unredacted. It must FAIL leg 5 on *no secret in a report*.
- `rescue-unreported`: the Shift Coordinator's answered crash is not reported. It must FAIL leg C on *the Shift Coordinator's own crash reaches Inbox*.
- `post-on-touch`: a delegate's failed post goes out only on the board's next touch. It must FAIL leg C on *the delegate's failed post reaches Inbox*.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-14 | edd35a64a + uncommitted check | Claude Code (Agent SDK 0.3.234); gpt-5.4-mini (leg M) | FAIL | Legs 2, 3, 4, 5, 6, H and M passed. Leg 1 failed on *the replay trips the same fingerprint*: the reporter's harness wrapped up after its draft, and the draft was read from the final message only, so the issue held the fallback title and the wrap-up. Fixed in af70213af (the draft is the newest of the run's messages that holds one), which also makes the issue's Project the failing session's, not the tracker's. Leg 7 failed because `[gives-up]` completed: a run that commits nothing passes the phase's check. The plant now reports that run errored. Also found: the chief of staff's `best-fit` routing rescues a failure in its own turn, so no final failure exists for it. The check sends the planted failures to Sandbox's project coordinator (`judgment`) instead. |
| 2026-10-14 | af70213af | Claude Code (Agent SDK 0.3.234); gpt-5.4-mini (leg M) | PASS | All legs. Leg 1: one Inbox ask, 0 tracker calls before the answer, ids equal the store's; REC-1 "Project-coordinator judgment turn dies with a raw TypeError ("reading 'split'") when asked for a project's status", labels ["P1"], priority 1, names openai/gpt-5.4-mini; the replay named project-coordinator (shared/sandbox) and tripped fingerprint 507382777bb79298bfbff50511311cb4 in a clean Lab. Leg 2 count 11. Leg 3: 5 reports + 1 storm report listing 25. Leg 5: 5 reports, 6 report-session records, 2 tracker calls, no secret. |
| 2026-10-14 | af70213af | as above | controls | `via-coordinator` FAIL leg 1 *one report in Inbox* (no report row). `stack-only` FAIL leg 1 *the replay trips the same fingerprint* (the replay messaged "shift-manager"). `skip-preview` FAIL leg 1 *nothing filed before the answer*, once leg 1 waits for the reporter to go idle before reading Inbox (added after this commit; its first run read Inbox before the filing started and failed on *one report in Inbox* only). `no-dedupe` FAIL leg 2 *one report* (11). `no-cap` FAIL leg 3 *at most 5 reports* (30). `eager` FAIL leg 4 *no report for a task that passed on retry*. `no-redact` FAIL leg 5 *no secret in a report* (the Lab's secret in a report session's record). |
| 2026-10-15 | 13c30962b | Claude Code (Agent SDK 0.3.234); gpt-5.4-mini (leg M) | PASS | All legs, with leg C new. Leg C: the chief of staff's crash completed its request ("Nobody took this post") and its report reached Inbox; researcher's failed post (planted throw) reached Inbox as a task report. Leg 1 replay tripped fingerprint 507382777bb79298bfbff50511311cb4; leg 2 count 11; leg 3: 5 reports + 1 storm listing 25; leg 5: no secret; leg 6 retried into Inbox after the restart. Later commits on the branch (a report send made best effort, the intake applying the Lab's filter to request occurrences) change no path this run takes and were not re-run end to end; their unit tests were run red and green. |
| 2026-10-15 | 13c30962b..4d0e4e71f | as above | controls | `rescue-unreported` FAIL leg C *the chief of staff's own crash reaches Inbox*. `post-on-touch` FAIL leg C *the delegate's failed post reaches Inbox*. `via-coordinator` FAIL leg 1 *one report in Inbox*. `no-dedupe` FAIL leg 2 *one report*. `no-cap` FAIL leg 3 *at most 5 reports*. `eager` FAIL leg 4. `no-redact` FAIL leg 5. `skip-preview` FAIL leg 1 *nothing filed before the answer* on its second run; its first run's draft hit Claude Code's 40-turn limit and stopped before any row reached Inbox. `stack-only` failed leg 1 on *the draft/issue carries the ids*, NOT on its named assertion: the replay, given only the error, guessed the project coordinator and Sandbox and tripped the same fingerprint. Its named assertion no longer discriminates; recorded, not fixed here. |
