---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

Add the `hold` and `defer` concurrency policies. A `hold` request runs at once and marks its key busy while it runs; it never waits and is never refused. A `defer` request waits until nothing on its key is running or waiting, then runs, so follow-up work for a conversation lands after the current reply instead of beside it. Deferred requests run one at a time, and the wait ends when the request ahead settles, or when a crashed process's place on a shared lease backend expires. Both policies apply to in-process runs; a run handed to an external dispatcher under either runs as `allow`.
