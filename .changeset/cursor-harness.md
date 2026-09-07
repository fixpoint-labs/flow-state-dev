---
"@flow-state-dev/cursor": patch
---

New package `@flow-state-dev/cursor` runs Cursor's coding agent as a block, returning the same neutral harness handle `@flow-state-dev/claude-code` and `@flow-state-dev/codex` return.

`cursorAgent()` creates or resumes a Cursor agent in a directory you resolve, sends one prompt, mirrors the run into the item stream, and returns the handle; `createCursorAgentCapability()` exposes it to a generator as a tool. The block's input is the prompt — where a run writes (`cwd`) and which agent it continues (`resume`) are resolvers you supply, and `onSession` is called with the agent id before the prompt is sent so a cancelled run stays resumable.

Requires `@cursor/sdk` at exactly 1.0.31 as an optional peer. Building against any other installed version throws, and so does a version that cannot be determined; there is no override. This version drives Cursor's local runtime only — a `cloud` option bag is refused when the block is built. Cost on the handle is an estimate and is `null`, never `0`, when the model is unknown, unpriced, or the run reported no usage.
