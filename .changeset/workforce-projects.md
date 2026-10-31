---
"@flow-state-dev/workforce": minor
---

Projects: an organization's `projects` collection (`defineProjectsCollection`), and `defineProjectBlocks` for writing rows. `createProject` creates a row owned by the calling session's owner, with its members. Refusals are `ProjectRefusedError` (FIX-1718, part of FIX-1793).
