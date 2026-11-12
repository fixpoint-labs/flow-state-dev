---
"@flow-state-dev/workforce": minor
"@flow-state-dev/shift-manager": patch
---

A project's reads need no session: a workstream's report is a view on the roster flow, the repository check is a view, and the workforce client reads a workstream's entry by scope (FIX-2624).

- The roster flow serves a `workstreamReport` view: one workstream entry's latest report, `{ report }` (`null` when it has none), for `{ project, owner, id }`, at user scope with no session. Anyone in the organization reads a shared project's reports; a private project's address reaches only the reader's own. `workstreamReportView` from `@flow-state-dev/workforce/browser` is its handle.
- **Breaking:** `defineProjectBlocks({ checkRepository })` returns the repository check as `views.checkRepository`, a user-scope view read with no session, in place of `actions.checkRepository`, which is removed. Install it with `views: { ...projects.views }` and read it with `client.view(viewRef(flow, "checkRepository"), { repository })`. Its answer is unchanged. `CheckRepositoryView` is its type.
- `createWorkforceClient` finds and makes no roster session: a lookup by workstream reads its entry by scope. `WorkforceClientSource` no longer needs `resources`.
- `WORKSTREAMS_PATTERN` is exported from `@flow-state-dev/workforce/browser`.
- Shift Manager reads the projects, a project's entries and an entry's report with no session, and opens no reading session for any user.

Docs: packages/workforce/README.md (Projects: the `checkRepository` view in place of the action, and `views` in the `defineProjectBlocks` row; the browser API list gains `workstreamReportView` and `WORKSTREAMS_PATTERN`; the roster flow's views gain `workstreamReport`), apps/docs/docs/shift-manager/overview.md (projects need no reading session).
