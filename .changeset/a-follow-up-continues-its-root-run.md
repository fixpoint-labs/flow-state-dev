---
"@flow-state-dev/harness-manager": patch
---

A follow-up of a coding task (`followUpOf`) now continues its root task's run (FIX-2274): the same checkout and branch, with the root's commits in place, and the root's coding session. A follow-up of a follow-up continues the same root. A task with no `followUpOf` keeps its run where it was. A host's own session door keys a task's run the same way with the new `runIssueSegment(task, lookup)`.
