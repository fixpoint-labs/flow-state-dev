# @flow-state-dev/codex

## 0.0.5

### Patch Changes

- Updated dependencies [53b50f0]
- Updated dependencies [8dc242e]
- Updated dependencies [7d4158f]
- Updated dependencies [211679a]
- Updated dependencies [2969b30]
- Updated dependencies [a74429a]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [a7f1c41]
- Updated dependencies [7d4c413]
- Updated dependencies [3311cc2]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [407964a]
  - @flow-state-dev/core@0.3.0

## 0.0.4

### Patch Changes

- Updated dependencies [b597600]
- Updated dependencies [6b8bfe4]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
  - @flow-state-dev/core@0.2.0

## 0.0.3

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/core@0.1.2

## 0.0.2

### Patch Changes

- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
  - @flow-state-dev/core@0.1.1

## 0.0.1

### Patch Changes

- d7208f7: LAB-153: new package `@flow-state-dev/codex` runs OpenAI's Codex agent as a block, returning the same neutral harness handle `@flow-state-dev/claude-code` returns.

  `codexAgent()` starts or resumes a Codex thread in a directory you resolve, mirrors the run into the item stream, and returns the handle; `createCodexAgentCapability()` exposes it to a generator as a tool. The block's input is the prompt — where a run writes (`cwd`) and which thread it continues (`resume`) are resolvers you supply, and `onSession` is called with the thread id mid-run so a cancelled run stays resumable.

  Requires `@openai/codex-sdk` at exactly 0.152.1 as an optional peer. Building against any other installed version throws, and so does a version that cannot be determined; there is no override. Cost on the handle is an estimate and is `null` — never `0` — when the model is unknown, unpriced, or the turn reported no usage.

- Updated dependencies [67b4157]
- Updated dependencies [527c5ca]
- Updated dependencies [4e562d0]
- Updated dependencies [afcac3d]
- Updated dependencies [3cbc411]
- Updated dependencies [b3e6e22]
- Updated dependencies [ce85e80]
- Updated dependencies [d7208f7]
- Updated dependencies [1b94521]
- Updated dependencies [5fa52aa]
- Updated dependencies [2c4b0f5]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/core@0.1.0
