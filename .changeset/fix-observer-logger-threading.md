---
"@flow-state-dev/engine": patch
---

Fix request-lifecycle observer blocks (`onStarted`/`onCompleted`/`onErrored`/`onFinished`) and resource-change-triggered reactive blocks falling back to the console-based default logger instead of the caller's configured `runtimeConfig.logger`. Previously this wrote raw debug/info execution traces straight to stdout regardless of the configured log level, corrupting `fsdev run`'s NDJSON output and `fsdev chat`'s transcript.
