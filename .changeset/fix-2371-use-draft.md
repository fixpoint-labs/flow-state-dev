---
"@flow-state-dev/react": patch
---

`@flow-state-dev/react` exports `useDraft(namespace, id)` and `clearDraft(namespace, id, sent?)`: a message box's unsent text kept in `localStorage` under `<namespace>:<id>`, so a reload or remount brings it back. Clear it once the send lands, so a failed send keeps the text (FIX-2371).
