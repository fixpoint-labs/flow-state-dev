---
"@flow-state-dev/workforce": minor
---

Each person talks to a project through their own project coordinator: name a standard coordinator worker as `createWorkerInstallation({ projectCoordinator })`, and `ensureWorkerSession({ worker, projectId: { visibility, id } })` finds or creates the person's one session of it for that project, refused for a project they can't read. Its delegates are the person's open workstreams there, one record each, kept in step by `openWorkstream` and `updateWorkstream` (done removes it, back out of done restores it), so a post it hands on lands in that workstream's own session and never in another person's; `projectCoordinatorTools.readProject` lets it read the project, every workstream's entry and the progress. An owner with 25 open workstreams in one project is refused another. `parseWorkstreamEntry` (also on `@flow-state-dev/workforce/browser`) parses an entry the way `readProject` does (FIX-1793).
