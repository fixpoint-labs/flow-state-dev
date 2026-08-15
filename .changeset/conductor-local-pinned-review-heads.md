---
---

Internal: two fixes to the local source in `@flow-state-dev/conductor` (private,
unpublished).

An undated review can no longer be retargeted onto a head nobody reviewed. A
review file's timestamp and git's commit times are both second-precision, so
`rev-list -1 --before=<second>` cannot tell the commit a reviewer read from one
pushed later inside that same second. Re-derived on every poll, the answer moved:
the approval followed the branch forward, never went stale, and released a SPEC
or IMPLEMENTATION approval gate on a commit the human never saw. The head each
undated review resolves to is now written down the first time it is resolved, in
`submissions/<n>/reviewed-heads.json` — beside the reviewer inbox, never in it,
so the inbox stays human-only by construction. Re-saving a verdict still
resolves fresh, because a saved verdict is a new review with a new id.

A check record with a conclusion outside `pending`/`success`/`failure` is now
refused rather than cast through. `{ "conclusion": "sucess" }` is valid JSON and
a plausible typo, and it was the one value with no safe reading: non-null, so
`awaiting_ci` applied; never `success`, so no gate could be satisfied; neither
`success` nor `failure`, so reconciliation emitted nothing. The submission waited
forever with nothing logged. The read now fails naming the file and the value.
