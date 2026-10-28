---
"@flow-state-dev/engine": patch
---

A task's notice held for the request that filed it no longer waits out its resend backoff when that request's server died mid-run. `requestHost.waits.running` now answers `false` for a request still recorded `in_progress` whose registry heartbeat has been silent past the host's stale-request threshold (where the flow's heartbeat is on and beats at least twice per threshold), and the stale-request and startup sweeps bring the wakes kept for the session of each request they mark interrupted forward to now, so the filer's pass sends the notice at once. With the defaults, the notice is heard within about 90 seconds of the request's last heartbeat. `detectInterruptedRequests` and `createStaleRequestSweeper` take an optional `wakeEntriesOf` for this (FIX-2166).
