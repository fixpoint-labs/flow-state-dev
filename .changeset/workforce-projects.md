---
"@flow-state-dev/workforce": minor
---

Projects: an organization's `projects` collection (`defineProjectsCollection`), and `defineProjectBlocks` for writing rows. `createProject` creates a row owned by the calling session's owner, with its members and the workstreams (declared mailboxes, from any team) it groups; a workstream belongs to at most one project, claimed with `create` before the row is written. `setWorkstreams` replaces the list, members only. Refusals are `ProjectRefusedError` (FIX-1718, part of FIX-1793).
