---
"@flow-state-dev/workforce": minor
"@flow-state-dev/shift-manager": patch
---

A project is read and written with no session: a client reads projects by scope and sends a project write to the projects collection, which the projects flow runs; a workstream's report and the repository check are views (FIX-2624).

- **Breaking:** the projects collections (`projects/*` at org and user scope) take `runBy: { flow: PROJECTS_FLOW }`, and `PROJECTS_FLOW` (`"projects"`) is now a contract: register the project blocks' actions on a flow of that name. A client sends a project write to the collection, `client.resource({ scope, pattern: PROJECTS_PATTERN }).send("createProject", input)`, and it runs on that flow in the writer's own write session, with the same checks as before. A host that serves projects but registers no projects flow refuses the write with `409 runby_flow_missing`. `PROJECTS_FLOW` and `PROJECTS_PATTERN` are exported from the package root and from `/browser`.

- The roster flow serves a `workstreamReport` view: one workstream entry's latest report, `{ report }` (`null` when it has none), for `{ project, owner, id }`, at user scope with no session. Anyone in the organization reads a shared project's reports; a private project's address reaches only the reader's own. `workstreamReportView` from `@flow-state-dev/workforce/browser` is its handle.
- **Breaking:** `defineProjectBlocks({ checkRepository })` returns the repository check as `views.checkRepository`, a user-scope view read with no session, in place of `actions.checkRepository`, which is removed. Install it on the projects flow with `views: { ...projects.views }` and read it with `client.view(checkRepositoryView, { repository })`; `checkRepositoryView` from `@flow-state-dev/workforce/browser` is its handle, on `PROJECTS_FLOW`. Its answer is unchanged. `CheckRepositoryView` is its type.
- `createWorkforceClient` finds and makes no roster session: a lookup by workstream reads its entry by scope. `WorkforceClientSource` no longer needs `resources`.
- `WORKSTREAMS_PATTERN` is exported from `@flow-state-dev/workforce/browser`.
- Shift Manager reads the projects, a project's entries and an entry's report with no session, and opens no reading session for any user.

Docs: apps/docs/docs/workforce/projects.md (register the project blocks on `PROJECTS_FLOW`; a client writes a project by sending to the collection and reads projects by scope; the examples that spell the flow name as a string), apps/docs/docs/orchestration/harness-manager.md (its two projects-flow examples spell the name as a string: use `PROJECTS_FLOW`), packages/workforce/README.md (Projects: `PROJECTS_FLOW` and `PROJECTS_PATTERN`, the collections' `runBy`, the `checkRepository` view in place of the action, and `views` in the `defineProjectBlocks` row; the browser API list gains `workstreamReportView`, `checkRepositoryView`, `PROJECTS_FLOW`, `PROJECTS_PATTERN` and `WORKSTREAMS_PATTERN`; the roster flow's views gain `workstreamReport`), apps/docs/docs/shift-manager/overview.md (projects need no reading session).
