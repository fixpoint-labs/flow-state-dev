---
"@flow-state-dev/devtool": patch
---

The DevTool has a Workstreams tab. It lists the background work hanging off the open session — one row per workstream, with the topic it is for, the board and worker it was routed to, and the state its runs reached. Clicking a row opens that workstream in the workspace, so its own stream, trace and tasks read like any other session's, with a breadcrumb back to the conversation you came from.

Where a workstream is running a task on a board in the session, the Tasks tab shows a link on that task's row.

The tab reads the whole list rather than the server's first page, so a session with a lot of background work no longer hides its newest workstreams behind a count that looks complete. Past 500 rows it says it is showing a partial list instead of stopping quietly.

Also fixes three related staleness bugs. Switching sessions kept the previous session's requests on screen until the new session's read landed, and live mode could attach to a request in the session you just left and render its items under the new one. Switching sessions also left live mode holding the request you had dispatched in the old one, so it would not follow work already running in the session you opened. And overlapping reads of the same session's workstreams could land out of order, letting a stale response put a finished workstream back to active.
