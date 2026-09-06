# @flow-state-dev/codex

## 0.0.1

### Patch Changes

- d7208f7: LAB-153: new package `@flow-state-dev/codex` runs OpenAI's Codex agent as a block, returning the same neutral harness handle `@flow-state-dev/claude-code` returns.

  `codexAgent()` starts or resumes a Codex thread in a directory you resolve, mirrors the run into the item stream, and returns the handle; `createCodexAgentCapability()` exposes it to a generator as a tool. The block's input is the prompt — where a run writes (`cwd`) and which thread it continues (`resume`) are resolvers you supply, and `onSession` is called with the thread id mid-run so a cancelled run stays resumable.

  Requires `@openai/codex-sdk` at exactly 0.152.1 as an optional peer. Building against any other installed version throws, and so does a version that cannot be determined; there is no override. Cost on the handle is an estimate and is `null` — never `0` — when the model is unknown, unpriced, or the turn reported no usage.

- Updated dependencies [3cbc411]
- Updated dependencies [b3e6e22]
- Updated dependencies [d7208f7]
- Updated dependencies [1b94521]
- Updated dependencies [5fa52aa]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/core@0.1.0
