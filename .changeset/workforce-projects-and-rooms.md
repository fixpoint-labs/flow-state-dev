---
"@flow-state-dev/workforce": minor
---

Projects: an organization's `projects` collection (`defineProjectsCollection`), and `defineProjectBlocks` for writing rows. `createProject` creates a row owned by the calling session's owner, with its members and the workstreams (declared channels, from any team) it groups; a workstream belongs to at most one project, claimed with `create` before the row is written. `setWorkstreams` replaces the list, members only. Each project has one room, stored as `room-lines` rows, that its members reach through their own talk session on the channel kind: the channel kind gains `join` (and an internal `bind`), and `post`, `read { after }` and `answer` on a session bound to a project read and write the room, members only (`not-a-member` otherwise). On every other session they behave as before. Refusals are `ProjectRefusedError`.
