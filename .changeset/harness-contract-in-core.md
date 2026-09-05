---
"@flow-state-dev/core": minor
"@flow-state-dev/claude-code": patch
---

A shared contract for coding-agent harnesses, so a harness package no longer has
to be built against another vendor's internals.

`@flow-state-dev/core` now exports the shape a harness block is handed and the
handle it returns — `harnessRunInputSchema` and `harnessRunHandleSchema` (plus
`harnessRunEnvelopeSchema` for a fire-and-forget dispatch), with
`HarnessRunInput`, `HarnessRunHandle`, `HarnessBlock`, `HarnessResolver` and
`HarnessSessionHook` on `@flow-state-dev/core/types`. The handle names how a run
ended (`outcome`: finished, stopped at a limit, or failed), its final message,
usage, and cost — including whether that cost was reported by the agent or
estimated. The input is the prompt alone: a working directory or a session to
resume reaches a harness through a resolver the host supplies, not through a
schema a model calling the block as a tool can see.

`@flow-state-dev/claude-code`'s handles are the neutral ones plus Claude's own
`resultSubtype` and `toolsObserved`. Two visible changes: `source` now reads
`claude-code/sdk` and `claude-code/cli-remote` (the `<package>/<door>`
convention every harness follows) and handles saved under the old `sdk` /
`cli-remote` spellings still load; and the SDK handle carries `outcome` and
`cost` alongside the existing `costUsd`, which stays for now. The package's
`RemoteAgentTaskHandle`, `RemoteAgentSource`, `RemoteAgentStatus` and
`remoteAgentTaskHandleSchema` are deprecated aliases of the core shapes.
