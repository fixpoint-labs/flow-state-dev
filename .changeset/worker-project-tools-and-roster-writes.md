---
"@flow-state-dev/workforce": minor
---

Workers can make, find and pick a project from their own turn, and an app can hire, change and fire the user's own workers through the workforce client (FIX-2309).

- `projectTools(defineProjectBlocks())` returns `listProjects` (with `forCoding`, what to do with a coder's task that names no project), `createProject` and `setRepository` (each waits for the user's approval before it writes a repository), and `setBrief`, as tools for a worker flow's catalog. `setWorkProjectTool` is the `setWorkProject` action as a tool, so a worker can put its own conversation in the project it just created or picked.
- `projectSourceTools(workspace)` is exported, so a flow whose workers write a `tools:` line can put the three project-source reads in its catalog.
- `createWorkforceClient(fsd)` gains `hire`, `fork`, `edit` and `fire`, which run the roster flow's actions of the same names on the user's roster session.
