---
"@flow-state-dev/harness-manager": minor
---

A harness session's turn now has a deadline (FIX-2680).

- **harness-manager:** `harnessSessionFlow` takes `turnTimeoutMs`, how long the harness may run in one turn, in ms. **Default 60 minutes**, where before a turn had no deadline: a turn that legitimately runs longer than an hour is now stopped unless the host raises it. At the deadline the harness step is stopped through the same abort a stop uses, so a harness that stops its process on abort (Claude Code, Cursor) takes the agent's process group down with it. The turn fails with the error `the turn's harness timed out after <ms>ms and was stopped`, the harness's own error as its `cause`. With `approveTools` on, time waiting on a user's answer about a tool call doesn't count: each run the turn resumes gets the whole deadline again. A value that is not a positive whole number of ms a timer honours (at most 2147483647) is refused when the flow is built.
- **harness-manager:** a turn's record (`harnessTurnRecordSchema`) gains `timedOut`: `true` on a turn stopped at its deadline, whose `stopped` is `false` so a page tells it apart from a person's stop; `null` otherwise, and on records stored before it.

Docs: packages/harness-manager/README.md (the session flow's options: `turnTimeoutMs` and its 60-minute default; the turn record's `timedOut` field).
