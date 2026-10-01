---
"@flow-state-dev/claude-code": minor
---

Remove the experimental `claude --remote` dispatch path from `@flow-state-dev/claude-code/cli` (FIX-1174).
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
