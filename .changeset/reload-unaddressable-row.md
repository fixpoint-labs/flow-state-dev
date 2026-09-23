---
"@flow-state-dev/workforce": patch
---

`reloadHiredSeats` no longer rejects when a stored roster row cannot be addressed, such as a runtime hire made under the development organization or a seat id starting with `~`. That row is skipped and named in `problems`, and every other organization's seats still reload (FIX-1536).
