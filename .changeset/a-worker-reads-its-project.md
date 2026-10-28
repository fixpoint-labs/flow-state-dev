---
"@flow-state-dev/workforce": minor
---

A worker can read the project its session works in without a coding run (FIX-2285). `projectSourceCapability({ workspace })` has one preset, `read`. A worker names it in its file (`capabilities: { projectSource: [read] }`) to get `globProjectSource`, `readProjectSource` and `grepProjectSource`. Each tool finds the project through the host's run source (`projectWorkspace()`) and returns a refusal as its result, `{ kind: "refused", reason, message }`. Pass the host the app's coding runs use. A host with no `readSource` is refused when the capability is built.

`projectWorkspace()` now refuses a run in a workstream's session, or in a task filed from one, with `not-a-member` when the workstream's owner is no longer one of the project's members. The project path already did this.
