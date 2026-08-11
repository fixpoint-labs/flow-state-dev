---
"@flow-state-dev/engine": patch
"@flow-state-dev/cli": patch
---

`fsdev run` and `fsdev chat` can now start background work, so a flow that hands
a task to a workstream can be exercised from the terminal instead of only over
HTTP.

Without a queue the command runs that work in its own process and waits for it
before exiting, up to `detachedDrainTimeoutMs` (default 30 seconds); if the
budget runs out it cancels the work and prints which requests it stopped. With a
queue configured it hands the work over and exits without waiting. Background
work now also runs under the same settings as the command that started it,
including a `--model` override.

Running without an `fsdev.config.*` still cannot start background work, and
neither can a queue-only worker process.
