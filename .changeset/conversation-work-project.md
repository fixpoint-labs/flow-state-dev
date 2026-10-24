---
"@flow-state-dev/workforce": minor
---

A user's own conversation with a worker can work in a project (FIX-2161). `createWorkforceClient(...).setWorkProject(worker, { visibility, id }, { sessionId? })` sets it on the user's default conversation with the worker, or on another session of theirs with it, such as a new session just created. The conversation's coding runs, and the tasks it files from then on, work in that project through `projectWorkspace()`. A later call replaces the project; tasks already filed keep the one they were filed in.

The call is refused, storing nothing, for a project the user isn't a member of (a private one: isn't theirs), and on the project coordinator's, a task's, a delegate's or a workstream lead's session. It runs the `setWorkProject` action (`SET_WORK_PROJECT_ACTION`), which the agent, coordinator and Error Reporter flows declare; an app's own worker flow declares `setWorkProjectAction` under that name. The project is kept in the server-owned session field `workProjectId` (`WORK_PROJECT_STATE_KEY`), which a session create can't seed.
