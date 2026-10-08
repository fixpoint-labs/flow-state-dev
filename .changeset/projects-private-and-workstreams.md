---
"@flow-state-dev/workforce": minor
---

Projects can be private or shared, and each workstream in a project has one owner.

- `createProject` takes `visibility`: `"shared"` (the default) keeps the project in the organization, where everyone reads it; `"private"` keeps it in the creator's own user scope, where nobody else lists or reads it and it shows only in the organization it was made in. A private project names no other members (`private-has-members`) and lists no workstreams by mailbox id (`private-has-workstreams`). The answer carries the project's `visibility`.
- A project's address is its visibility and its id, `{ visibility, id }`. `setRepository` and `readProjectFiles` now take `{ project: { visibility, id } }` in place of `projectId`. The private rows and files are `definePrivateProjectsCollection()` and `definePrivateProjectFilesCollection()`, at `projects/*` and `project-files/**` in user scope.
- `defineWorkstreamBlocks({ installation, leadFlows })` adds `openWorkstream` and `updateWorkstream`. Opening one writes the caller's own entry at `workstreams/<project>/<~owner>/<workstream>` and starts the lead's workstream session, owned by the caller, on a lead from their roster. On a shared project only its members may open one. Everyone who reads the project reads every entry (title, lead, status, due date, objectives, latest report, `writtenBy`); only the owner can change theirs, whichever flow writes. `updateWorkstreamTool` lets a lead update the workstream its session leads.
- A worker flow lets its workers lead a workstream by declaring `workstreamOpenedEntry()` under `internal.actions[WORKSTREAM_OPENED_ENTRY]`. The built-in `agent` flow declares it.
- `findWorkerSession` and `ensureWorkerSession` take a `workstreamId` criterion: `{ project: { visibility, id }, id }`. A worker session naming a workstream is created only for the caller's own entry, with the lead that entry names.
- `readProject` returns a project's row, every workstream's entry and its progress, from two reads. `projectProgress(entries, now)` works progress out the same way anywhere: workstreams by status, objectives met of total, the next due date, and entries unchanged for `STALE_AFTER_MS` (seven days).
- `projectWorkspace()` finds a run's project from the workstream its session leads, at the project's visibility, and refuses a run whose owner isn't the workstream's (`not-the-owner`). Its `board` option is now optional; a mailbox board still finds its project through its claim.
- `sharedResource(pattern, shape, options)` takes the rest of a collection's declaration, a user scope included, and `withWrittenBy(ctx, data)` stamps `writtenBy` for a writer that needs its own write.
