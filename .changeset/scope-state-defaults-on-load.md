---
"@flow-state-dev/engine": patch
"@flow-state-dev/workforce": patch
---

Scope state reads with its schema's defaults (FIX-2554).

`ctx.session.state`, `ctx.user.state` and `ctx.org.state` now hold the default of every defaulted field of the flow's scope `stateSchema` that the stored record lacks, as their `z.infer` type already promised: on a fresh user or session, on a record stored before the field existed, and after a concurrent write. Only missing values are filled in; a stored value is read as stored, and keys the schema doesn't declare are kept, so another flow's fields on a shared user or org record survive. The `/state` projection's `clientData` and the session listing read the same way. A `?? default` fallback on a field the flow's schema defaults can go. A block's or capability's own `sessionStateSchema` still only types `ctx.session.state`.

An `incState` or `pushState` on a field the stored record lacks builds on the field's default (`count.default(10)` plus 1 is 11), not on the store's empty start.

`hireWorkforce` refuses a worker flow registered as a manager or coordinator whose session `stateSchema` doesn't default the fields its board and delegates read (`delegates`, `fallback`, `taskNotices`, and a coordinator's rounds). Declare `session: installation.session(board.sessionStateShape)`.
