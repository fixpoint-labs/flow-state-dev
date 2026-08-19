---
"@flow-state-dev/claude-code": minor
---

`claudeCodeAgent` and `createClaudeCodeAgentCapability` take `detached: true`,
so the agent can run as background work on a task board (LAB-133).

The agent normally keeps two things in session state: the SDK session id it
resumes on the next request, and a log of the run handles it has returned. A task
board refuses to build a background worker whose block declares session state at
all, because those workers share one flow and would overwrite each other's keys —
so until now the agent could not be dispatched as one.

`detached: true` suppresses the declaration, the reads and writes that go with
it, and the SDK `resume`. Each job is then one run, starting fresh; its own
history is the workstream's item stream. Everything else is unchanged — the items
the run emits, the handle it returns, and how failures surface are identical.
Default is `false`, so callers who do not set it are unaffected in every respect.

The capability takes the same option, and honouring it there is required rather
than a convenience: it declares the schema separately from the block, through a
channel the board's check cannot see.

Also removes the exported type `CreateClaudeCodeAgentCapabilityOptions`, which
was an empty extension of `ClaudeCodeAgentOptions`. Use that instead.
