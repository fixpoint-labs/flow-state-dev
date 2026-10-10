---
"@flow-state-dev/client": patch
"@flow-state-dev/react": patch
"@flow-state-dev/devtool": patch
"@flow-state-dev/shift-manager": patch
"@flow-state-dev/workforce": patch
---

`@flow-state-dev/client` exports `readEveryCollectionPage`, one collection read with a single 1,000-page ceiling that fails when the server repeats a cursor, and the workforce panels, the DevTool Inventory tab, the Shift Manager and the workforce roster read now use it, so a repeated cursor ends a read with an error instead of 1,000 wasted page reads, a partial list shown as whole, or a read that never stops (FIX-1674).
