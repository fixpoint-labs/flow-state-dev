---
"@flow-state-dev/harness-manager": patch
---

A follow-up of a coding task (`followUpOf`) now continues its root task's run (FIX-2274): the same checkout and branch, with the root's commits in place, and the root's coding session. A follow-up of a follow-up continues the same root. The mode stays part of the run: a follow-up run in another mode than its root's has a run of its own. One task of a chain runs at a time: on a board with no one-open-task start test, a follow-up claimed while another task of its chain is still running fails that attempt, naming the running task, and the board's retry tries it again later. A task with no `followUpOf` keeps its run where it was. A host's own session door keys a task's run the same way with the new `runIssueSegment(task, lookup)`. `readModeRunRecord` takes, in place of the reading task's id, a test of whether a recorded task id is this run's, so a follow-up finds its root's run under a former key too.

Docs: packages/harness-manager/README.md (a host's own session door keys `runOf` with `runIssueSegment(task, lookup)`, not `taskIssueSegment(task.id)`, so a follow-up reads its root's run)
