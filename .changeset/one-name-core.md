---
"@flow-state-dev/core": minor
---

**Breaking:** core's names that another entry also exports for something else are renamed, so one name means one thing (FIX-2449). No deprecated aliases: an old import fails to compile with "has no exported member".

- `SessionView`, what the request host's `sessions.read` answers, is renamed `PeerSessionView`. React's `useSession` result keeps the name `SessionView`.
- On `@flow-state-dev/core/models`, the model resolver's `RetryPolicy` is renamed `ModelRetryPolicy`. A block's retry setting keeps the name `RetryPolicy`.
- `@flow-state-dev/core/blocks/sequencer` exports only the `sequencer` builder. Its other helpers, `executeBlock` among them, are no longer on that subpath.

Docs: packages/core/README.md (`PeerSessionView` in the request-host types list; the block-builder subpaths section says `@flow-state-dev/core/blocks/sequencer` carries only `sequencer`), apps/docs/docs/configuration/runtime.md (the `retryPolicy` row's type is `ModelRetryPolicy`)
