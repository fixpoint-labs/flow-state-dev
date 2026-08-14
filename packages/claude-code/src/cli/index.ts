/**
 * Public surface of `@flow-state-dev/claude-code/cli` — everything in this
 * package that reaches Claude Code by shelling out to the `claude` binary.
 *
 * One invocation mode lives here: **cloud dispatch** — `claude --remote`,
 * fire-and-forget, wrapped as an FSD block (`claudeRemoteDispatch`) with its
 * capability, resolver seam, stdout parser, handle types, and typed errors.
 * Everything goes through the `ClaudeCliExec` seam, so there is one
 * spawn-and-capture implementation and one place that mocks.
 *
 * For a **local, blocking run** — the agent working in a directory until it is
 * done — use `runClaudeHeadless` from `@flow-state-dev/claude-code/sdk`. It
 * drives the Agent SDK rather than the binary, so it gets the harness the SDK
 * maintains and a structured terminal result instead of parsed stdout.
 */
export {
  claudeRemoteDispatch,
  claudeRemoteTasksSchema,
  CLAUDE_REMOTE_TASKS_KEY,
  type ClaudeRemoteDispatchOptions,
} from "./dispatch";
export {
  createClaudeCliCapability,
  type CreateClaudeCliCapabilityOptions,
} from "./capability";
export {
  defaultResolveClaudeCli,
  defaultClaudeCliExec,
  type ResolveClaudeCli,
  type ResolvedClaudeCli,
  type ClaudeCliExec,
  type ClaudeCliExecOptions,
  type ClaudeCliExecResult,
} from "./resolve-cli";
// PTY-backed exec/resolver — the default bare-spawn exec cannot dispatch
// `claude --remote` (it requires a TTY); pass `resolvePtyClaudeCli` to do so.
export { scriptPtyClaudeCliExec, resolvePtyClaudeCli, stripAnsi } from "./pty-exec";
export { parseRemoteDispatchOutput, type ParsedRemoteDispatch } from "./parse-output";
export { claudeRemoteHandleSchema, type ClaudeRemoteHandle } from "./types";
export { ClaudeCliNotFoundError, ClaudeRemoteDispatchError } from "./errors";

// Re-export the shared envelope so `/cli` consumers don't need a second import.
export {
  remoteAgentTaskHandleSchema,
  type RemoteAgentTaskHandle,
  type RemoteAgentSource,
  type RemoteAgentStatus,
} from "../shared/handle";
