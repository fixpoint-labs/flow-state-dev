---
"@flow-state-dev/codex": patch
---

LAB-153: new package `@flow-state-dev/codex` runs OpenAI's Codex agent as a block, returning the same neutral harness handle `@flow-state-dev/claude-code` returns.

`codexAgent()` starts or resumes a Codex thread in a directory you resolve, mirrors the run into the item stream, and returns the handle; `createCodexAgentCapability()` exposes it to a generator as a tool. The block's input is the prompt — where a run writes (`cwd`) and which thread it continues (`resume`) are resolvers you supply, and `onSession` is called with the thread id mid-run so a cancelled run stays resumable.

Requires `@openai/codex-sdk` at exactly 0.152.1 as an optional peer. Building against any other installed version throws, and so does a version that cannot be determined; there is no override. Cost on the handle is an estimate and is `null` — never `0` — when the model is unknown, unpriced, or the turn reported no usage.
