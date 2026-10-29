---
"@flow-state-dev/workforce": minor
---

A worker flow can say its tasks need a project: `workerFlow(build, { needsProject: true })`, or `needsProject: true` on a `workerFlows` entry. A task for one of its workers filed with no project to work in (no workstream, no project on the conversation, none named in `input.project`) is refused at filing with `no_project`, before any row or run exists, so an app can ask for a project first. `projectWorkspace()`'s `no-project` refusal stays as the backstop, and its message now says to set the conversation's project (`listProjects`, then `setWorkProject`) instead of naming one in `input.project` (FIX-2333).
