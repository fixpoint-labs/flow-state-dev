---
"@flow-state-dev/workforce": minor
---

A project row records the git remote its code lives in: `repository: string | null`, default `null`, readable from the browser with the row. `createProject` takes an optional `repository`, and the new `setRepository { projectId, repository }` sets, changes or clears it for a member. Both refuse a path, a value starting with `-`, a control character, a remote-helper address and a value carrying a credential with the new refusal reason `invalid-repository`, without repeating the value. Stored rows are not re-parsed on read, so treat a missing `repository` as `null` or read through `projectRowSchema.parse`. A project's files live in the new org-scoped `project-files/<projectId>/…` collection (`defineProjectFilesCollection()`), with no browser read; members read them with the new `readProjectFiles` block, also in `defineProjectBlocks().actions` (FIX-1762).
