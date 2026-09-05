---
"@flow-state-dev/engine": patch
"@flow-state-dev/orchestration": patch
---

A detached spawn whose enqueue fails now settles its task instead of stranding it
(FIX-1095).

Handing work to a Workstream under an external dispatcher waits for the job to be
accepted. When the queue refused it, that failure was raised rather than reported,
and the task board had already released its claim by then — so nothing settled the
row and it sat `in_progress` until an unrelated drain reclaimed it. A failed
enqueue is now reported the same way every other pre-start refusal is: the board
takes its claim back and fails the row against a named reason.

A detached payload is also now serialized once before it is dispatched, so the
worker receives the same value whichever way the deployment delivers it. A payload
that reaches one object from two places is legal JSON, and an external dispatcher's
round trip turns those two references into two independent objects while an
in-process dispatch keeps them as one. Workers that mutate through a reference, or
compare two by identity, behaved differently by deployment mode. Taking the round
trip up front also means the value that was validated is the value that is sent.
