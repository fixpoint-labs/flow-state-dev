---
"@flow-state-dev/react": patch
---

`Roster` and `BoardColumns` now show their error line, with Retry, when a collection still has pages left after 1,000 reads, instead of rendering the rows read so far as the complete list (FIX-1577).
