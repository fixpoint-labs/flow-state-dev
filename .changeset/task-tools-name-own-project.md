---
"@flow-state-dev/workforce": patch
---

A worker filing tasks from a workstream or a project's conversation is told that conversation's project in its task tools' context, and to leave `project` out of a task's `input`, so it no longer guesses one (FIX-1970).
