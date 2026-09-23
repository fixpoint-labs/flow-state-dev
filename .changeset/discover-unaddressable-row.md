---
"@flow-state-dev/workforce": patch
---

The workforce discovery door no longer drops a whole organization's seat listing when one stored roster row cannot be addressed, such as a runtime hire made under the development organization or a seat id starting with `~`. That row is left out and every other seat is still listed. `reloadHiredSeats` now also files a row stamped for another organization under the organization it was read from in `byOrg`, not only in the flat `problems` (FIX-1541).
