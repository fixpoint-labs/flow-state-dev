---
"@flow-state-dev/claude-code": minor
---

`claudeCodeAgent` and `createClaudeCodeAgentCapability` take `sessionState: false`,
so the agent can run as background work on a task board.

The agent normally keeps two things in session state: the SDK session id it
resumes on the next request, and a log of the run handles it has returned. A
background job is one run in one child session, so nothing on that path reads
either back — and the task board refuses to build a background worker whose block
declares session state at all, because those workers share one flow and would
overwrite each other's keys. Until now the agent could not be dispatched as one.

Setting `sessionState: false` suppresses three things together: the declaration,
the reads and writes that go with it, and the SDK `resume`. The provider is not
consulted, so a custom session provider cannot hand back a saved id that silently
resumes a prior conversation. Everything else is unchanged — the items the run
emits, the handle it returns, and how failures surface are identical.

The capability honours it too, and has to: it declares the same schema separately
from the block, through a channel the board's check cannot see.

Default is `true`, so callers who do not set it are unaffected in every respect.
