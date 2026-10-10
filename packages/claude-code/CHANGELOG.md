# @flow-state-dev/claude-code

## 0.2.0

### Minor Changes

- 63b7b1d: Remove the experimental `claude --remote` dispatch path from `@flow-state-dev/claude-code/cli` (FIX-1174).
  These exports are gone: `claudeRemoteDispatch`, `ClaudeRemoteDispatchOptions`,
  `claudeRemoteTasksSchema`, `CLAUDE_REMOTE_TASKS_KEY`, `createClaudeCliCapability`,
  `CreateClaudeCliCapabilityOptions`, `scriptPtyClaudeCliExec`, `resolvePtyClaudeCli`, `stripAnsi`,
  `parseRemoteDispatchOutput`, `ParsedRemoteDispatch`, `CLAUDE_CLI_REMOTE_SOURCE`,
  `claudeRemoteHandleSchema`, `ClaudeRemoteHandle`, `ClaudeCliNotFoundError` and
  `ClaudeRemoteDispatchError`. Handles already written to `claudeRemoteTasks` in session state are
  no longer read by anything in this package.

  There is no drop-in replacement. The nearest alternative is `claudeCodeAgent` from
  `@flow-state-dev/claude-code/sdk`, which runs the agent in-process and streams its work instead of
  handing it to a cloud session. The `/cli` resolver seam (`defaultResolveClaudeCli`,
  `defaultClaudeCliExec` and their types) is unchanged.

- 02ee032: Remove backward-compatibility paths (FIX-1804, FIX-850): stores read only the current on-disk and table layouts with no migration of older data, `@flow-state-dev/claude-code` drops its package-root entry and deprecated handle aliases, `@flow-state-dev/patterns` drops `legacyWorkerAdapter` and `executableTaskSchema`, and removed options such as `clientData`, `requireOrg`, `presets`, `preset/*` model strings, `prefer` and `fileFilter`/`syncMode` are no longer refused by name.

### Patch Changes

- f14cc4a: `claudeCodeAgent` now waits, for up to 5 seconds, for the agent's process to exit after an abort before it rejects, so a run stopped right after it starts can be resumed instead of failing with "No conversation found" (FIX-1742).
- 958aac2: `claudeCodeAgent` now reports a failed run when the Agent SDK ends a turn with a `success` result flagged `is_error` (how the SDK reports an API error). The handle's `status` is `"errored"` and its `outcome` is `"failed"`, and an `error` item carries the SDK's error text; previously the run was recorded as completed (FIX-1175).
- 77b08f7: A Claude Code run inside a container now shows its top-level steps, including its sub-agent boxes, inside that container, as Codex and Cursor runs already do; steps inside a sub-agent still show inside the sub-agent (FIX-1701).
- f469423: `claudeCodeAgent` now puts the task's id on every item it emits when it runs inside a task, as the Codex and Cursor harnesses do, so a task's own view shows the run's messages, reasoning and tool calls (FIX-1692).
- Updated dependencies [cd6f7fb]
- Updated dependencies [0b57bc9]
- Updated dependencies [be1bddf]
- Updated dependencies [58ffc93]
- Updated dependencies [397cfa7]
- Updated dependencies [53b50f0]
- Updated dependencies [456fe85]
- Updated dependencies [62133c4]
- Updated dependencies [9d02ac6]
- Updated dependencies [8dc242e]
- Updated dependencies [7d4158f]
- Updated dependencies [211679a]
- Updated dependencies [5181ddb]
- Updated dependencies [8628a54]
- Updated dependencies [2969b30]
- Updated dependencies [a74429a]
- Updated dependencies [49d6397]
- Updated dependencies [a55d07f]
- Updated dependencies [7db4d13]
- Updated dependencies [9e3b823]
- Updated dependencies [df3de3b]
- Updated dependencies [423a405]
- Updated dependencies [ba74f01]
- Updated dependencies [7da156e]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [a7f1c41]
- Updated dependencies [80f6e25]
- Updated dependencies [b808784]
- Updated dependencies [311a6d5]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [db7df1c]
- Updated dependencies [839e915]
- Updated dependencies [02ee032]
- Updated dependencies [16bb676]
- Updated dependencies [9510a03]
- Updated dependencies [385d01e]
- Updated dependencies [3311cc2]
- Updated dependencies [7c9e932]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [97894aa]
- Updated dependencies [334c1e3]
- Updated dependencies [9ed6b29]
- Updated dependencies [a021cd1]
- Updated dependencies [cd180d7]
- Updated dependencies [68b8957]
- Updated dependencies [9cd314d]
- Updated dependencies [30aa133]
- Updated dependencies [407964a]
- Updated dependencies [5708f16]
- Updated dependencies [50edfd4]
- Updated dependencies [84cc226]
- Updated dependencies [57a859d]
- Updated dependencies [707b340]
  - @flow-state-dev/core@0.3.0
  - @flow-state-dev/workspace@0.2.0

## 0.1.3

### Patch Changes

- Updated dependencies [b597600]
- Updated dependencies [6b8bfe4]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
  - @flow-state-dev/core@0.2.0
  - @flow-state-dev/workspace@0.1.3

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/core@0.1.2
  - @flow-state-dev/workspace@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
  - @flow-state-dev/core@0.1.1
  - @flow-state-dev/workspace@0.1.1

## 0.1.0

### Minor Changes

- 3cbc411: A shared contract for coding-agent harnesses (LAB-152), so a harness package no
  longer has to be built against another vendor's internals.

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

- b3e6e22: Initial release (FIX-1187).
- 1b94521: Background Claude Code runs can continue a previous conversation (LAB-154).

  `claudeCodeAgent` and `createClaudeCodeAgentCapability` take `resume` (which
  session this run continues — return `null` to start fresh) and `onSession`
  (called during the run when the agent names its session, so a cancelled run's id
  is not lost). Both are background-path only and throw at construction without
  `detached: true`.

  Three things existing code can trip over:

  - **Every resolver option is now handed the block context alone.** `cwd`,
    `sandbox` and `resume` on `claudeCodeAgent`, and `root` on
    `createWorkspaceAgentCapability`, used to receive the run's input as a first
    argument. Drop it: `cwd: (_input, ctx) => …` becomes `cwd: (ctx) => …`.
  - **`costUsd` is gone from the SDK handle.** Read `cost.usd`. Handles already
    persisted with the old field still load.
  - **`HarnessResolver` in `@flow-state-dev/core/types` matches**, and its context
    keeps its types where it previously widened them to `any` — a resolver body
    reading an undeclared scope-state field no longer compiles.

### Patch Changes

- 9d6cdbe: A deadline on a `claudeCodeAgent` step now ends the run the instant it fires (FIX-1301), instead of waiting for the SDK's stream to settle first.
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
  - @flow-state-dev/workspace@0.1.0
