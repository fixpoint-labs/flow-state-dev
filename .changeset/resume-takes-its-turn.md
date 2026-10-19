---
"@flow-state-dev/engine": patch
---

A suspended request that resumes (a person's answer, a stop, or the durability sweep's re-drive) now takes its turn on its session's concurrency key instead of running beside whatever the session is running. Under `queue`, `reject` and `defer` it waits its turn under the `queue` budget; under `hold` it runs at once; under `allow` nothing changes. A resume that cannot get its turn in time stays suspended with its answer recorded and is re-driven by the durability sweep (FIX-2062).
