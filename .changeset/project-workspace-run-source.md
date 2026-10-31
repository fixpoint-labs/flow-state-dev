---
"@flow-state-dev/workforce": minor
---

`projectWorkspace()` is a run source for a workspace host: a coding run on a project's workstream works in a branch of the project's repository with the project's files beside it, or on the project's files alone when it has no repository (FIX-1762). It refuses a run whose owner is not a member, or whose workstream no project holds. The block that asks it holds `projectWorkspaceCapability`.
