---
"@flow-state-dev/devtool": minor
---

The DevTool has a Workstreams tab (FIX-1071). It lists the background work running under the open session — the topic it is for, the board and worker it was routed to, and the state its runs reached — and the Tasks tab shows a link on any task a workstream is running. Open a row, by mouse or by keyboard, and the workspace switches to that workstream: its stream, trace and tasks read like any other session's, with a breadcrumb back to the conversation you came from.

The Tasks tab now shows each task's current status, assignee and labels, and each board's current status and counts.

Switching sessions no longer leaves the previous session's requests on screen, and live mode follows work running in the session you opened rather than staying attached to the one you left.
