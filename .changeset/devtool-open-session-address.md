---
"@flow-state-dev/devtool": patch
---

The DevTool opens a session from its address: `?session=<id>` on the page opens that session under the flow that owns it, or says why it can't. `DevToolPanel` takes the same as an `openSessionId` prop, and `readSessionAddress()` reads it off the page (FIX-1691).
