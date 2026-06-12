---
"@flow-state-dev/tools": patch
"@flow-state-dev/core": patch
"@flow-state-dev/server": patch
"@flow-state-dev/devtool": patch
---

Failed items now surface actionable error detail in the DevTool instead of a bare message. The `fetch` tool classifies its failures (HTTP status, truncated response body, network/timeout/abort type) and attaches them to `error.details`; any thrown error's underlying `cause` chain is serialized so a buried `ECONNRESET` is no longer swallowed. `@flow-state-dev/core` exports a new `serializeError` helper, and the DevTool renders the HTTP status, response body, and cause chain as dedicated panels with an inline status summary on the collapsed row.
