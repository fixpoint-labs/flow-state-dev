---
"@flow-state-dev/devtool": patch
---

The DevTool's open session now refreshes as one unit. Clicking the Sessions refresh button reloads the active session's transcript, state, and resources together, and returning focus to the DevTool brings the open session up to date automatically. Previously a refresh only re-listed sessions, leaving the open view stale until you deselected and reselected it.
