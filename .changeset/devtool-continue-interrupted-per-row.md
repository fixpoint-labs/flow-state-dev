---
"@flow-state-dev/devtool": minor
"@flow-state-dev/client": minor
---

DevTool: any interrupted request row now has its own "Continue" action (in the request separator's overflow menu), gated to non-webhook-sourced requests since the server rejects webhook-sourced continuations. It streams the crash-recovery continuation inline via the new `recoveryClient.continueStream()` and merges into the row's existing items rather than clearing them. This supersedes the old top-level "Resume" button (removed), which only covered the latest interrupted request and used the non-streaming JSON `continue()` path. The request-row refresh sweep that promotes stale `in_progress` rows to `interrupted` is now gated behind `DevToolPanel`'s `autoRecoverInterrupted` prop (default `false`), matching the existing mount-time sweep's opt-in behavior.

`@flow-state-dev/client`'s `RequestStreamStore` gains `getRaw()`, returning the chronological item list without the crash-recovery canonical collapse, for consumers that need to render the pre-/post-recovery boundary itself.
