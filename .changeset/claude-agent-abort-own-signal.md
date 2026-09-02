---
"@flow-state-dev/claude-code": patch
---

A deadline on a `claudeCodeAgent` step now ends the run the instant it fires (FIX-1301).

Previously the block forwarded an aborted `ctx.signal` into the SDK's own abort controller and then waited for the SDK's stream to settle before throwing — so a caller's deadline was bounded by however long the vendor took to notice the abort and close its stream, not by the deadline itself. The block now races the SDK stream against its own signal and rejects the moment the signal fires, matching how a cancelled run already behaves everywhere else in the framework. The SDK is still told to stop (the abort controller forwarding is unchanged); the block simply no longer waits to find out whether it did. A session id already observed before the abort is still persisted, so the run remains resumable. A subprocess the vendor spawned can still outlive the abort — the run's working directory sandbox is the fence for that, not this deadline.
