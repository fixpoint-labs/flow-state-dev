---
"@flow-state-dev/engine": patch
---

The filesystem store now implements the CAS delta verbs (`patchField`, `incField`, `pushToArray`) so single-field scope-state writes no longer rewrite the whole record, and runOnce results persist to one file per key instead of a single rewritten map; legacy single-map runOnce files are still read transparently.
