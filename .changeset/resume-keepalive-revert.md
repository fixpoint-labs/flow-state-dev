---
"@flow-state-dev/engine": patch
---

Resuming a suspended request no longer fails, and no longer reopens the gate,
when the background-work hook throws (FIX-1095).

`runtimeConfig.onBackgroundWork` — the keep-alive hook a serverless adapter
wires to `after()` or `waitUntil` — is called once the resumed run is already
under way, and both of those throw synchronously when called outside a request
scope. That throw escaped the resume, which reported the resumption as having
failed during setup: it reverted the suspension to `pending` and released the
lease. The gate a reviewer had just approved reappeared as awaiting approval,
and approving it again started a second resume against a request whose first
one was still running and still writing to it.

The hook's failure is now contained and logged, and the resume reports what
actually happened. Registering keep-alive still matters — on a
freeze-after-response platform the resumed run can stall without it — so the
failure is reported rather than swallowed.
