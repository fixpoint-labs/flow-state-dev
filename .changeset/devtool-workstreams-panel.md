---
"@flow-state-dev/devtool": minor
---

The DevTool has a Workstreams tab (FIX-1071). It lists the background work hanging off the open session — one row per workstream, with the topic it is for, the board and worker it was routed to, and the state its runs reached. Clicking a row opens that workstream in the workspace, so its own stream, trace and tasks read like any other session's, with a breadcrumb back to the conversation you came from.

Where a workstream is running a task on a board in the session, the Tasks tab shows a link on that task's row. Tasks that share a topic but run on different workers link to their own workstream rather than all pointing at the first one, and where the pairing cannot be worked out from what the server sends, no link is drawn instead of a guessed one.

Rows open from the keyboard as well as the mouse.

The tab reads the whole list rather than the server's first page, so a session with a lot of background work no longer hides its newest workstreams behind a count that looks complete. Past 500 rows it says it is showing a partial list instead of stopping quietly — and a session with exactly 500 is not told there is more.

The Tasks tab also shows current state rather than older state. A task that changed across more than one request was displayed from the earliest of them, so its status, assignee and labels could all be out of date, and a board's status and counts came from a superseded run of it. Visible since the tab was added, and now also what workstream links are matched against.

Also fixes three related staleness bugs. Switching sessions kept the previous session's requests on screen until the new session's read landed, and live mode could attach to a request in the session you just left and render its items under the new one. Switching sessions also left live mode holding the request you had dispatched in the old one, so it would not follow work already running in the session you opened. And an action dispatched just before you switched sessions would attach itself to the session you moved to, streaming the previous session's run under it.
