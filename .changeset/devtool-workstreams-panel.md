---
"@flow-state-dev/devtool": patch
---

The DevTool has a Workstreams tab. It lists the background work hanging off the open session — one row per workstream, with the topic it is for, the board and worker it was routed to, and the state its runs reached. Clicking a row opens that workstream in the workspace, so its own stream, trace and tasks read like any other session's, with a breadcrumb back to the conversation you came from.

Where a workstream is running a task on a board in the session, the Tasks tab shows a link on that task's row.

Also fixes a related staleness bug: switching sessions kept the previous session's requests on screen until the new session's read landed, and live mode could attach to a request in the session you just left and render its items under the new one.
