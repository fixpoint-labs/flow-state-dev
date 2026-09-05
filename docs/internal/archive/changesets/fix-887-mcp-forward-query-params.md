---
"@flow-state-dev/mcp": minor
---

`createMcpTransportAdapter` gains a `forwardQueryParams` option: an allowlist of endpoint query-string params (e.g. `.../mcp?source=claude-desktop`) that are merged into the `tools/call` action input. The forwarded value overrides a same-named tool argument, so an operator can set an installation-level value once on the endpoint URL rather than relying on the model to supply it per call. Defaults to forwarding nothing; only `tools/call` is affected.
