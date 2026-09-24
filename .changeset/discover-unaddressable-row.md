---
"@flow-state-dev/workforce": patch
---

The workforce discovery door now leaves out a stored roster row it cannot address, such as one an app's own hire action wrote under the development organization or one whose seat id starts with `~`, instead of dropping the organization's whole seat listing, and `reloadHiredSeats` now files a row stamped for another organization under the organization it was read from in `byOrg` as well as in the flat `problems` (FIX-1541).
