---
"@flow-state-dev/workforce": minor
---

`projectWorkspace({ board })` is a run source for a workspace host: a coding run on a project's mailbox board works in a branch of the project's repository with the project's files beside it, or on the project's files alone when it has no repository. It refuses a run whose owner is not a member, or whose workstream no project holds. The block that asks it holds `projectWorkspaceCapability` (FIX-1762).
