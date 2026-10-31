---
"@flow-state-dev/workforce": patch
---

The workforce discovery door now leaves out a stored roster row it cannot address, such as one an app's own hire action wrote under the development organization or one whose worker id starts with `~`, instead of dropping the organization's whole worker listing (FIX-1541).
