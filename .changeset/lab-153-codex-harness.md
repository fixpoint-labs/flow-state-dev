---
"@flow-state-dev/codex": minor
---

LAB-153: a new `@flow-state-dev/codex` package runs OpenAI's Codex agent as a
block, returning the framework's neutral harness handle — the same shape
`@flow-state-dev/claude-code` returns, so a caller that reads the handle can drive
either agent.

`codexAgent()` starts or resumes a Codex thread in a directory the host resolves,
mirrors the run's messages, reasoning, commands and file changes into the item
stream, and returns the handle. `createCodexAgentCapability()` exposes it to a
generator as a tool.

Where a run writes and which conversation it continues are configuration, never
block input: the block is model-facing through its capability, so both arrive
through resolvers the host writes. `onSession` is the write side of `resume` — it
is called with the thread id the moment the run names one, before the run does any
work, so a run a deadline cancels is still resumable.

Codex is driven through `@openai/codex-sdk`, an **exact-pinned optional peer**.
Building against any other installed version throws, naming both versions: the
JSONL wire is experimental and can change in a lockstep CLI and SDK release, so a
Codex upgrade is a tested release of this package rather than something a host
takes on its own.

Cost is an estimate from the framework's model price table, and absent rather than
zero when the model is unknown, unpriced, or the turn reported no usage.
