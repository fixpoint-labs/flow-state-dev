---
"@flow-state-dev/react": patch
---

`useResourceCollection` no longer serves one session's cached pages after a switch to another session, collection or server, and a response that lands after the switch is never cached. `useResourceCollectionList` and `useResourceCollectionItem` no longer show the previous session's rows or item while the new session's read loads, and a late page from the old session no longer replaces the new rows (FIX-2037).
