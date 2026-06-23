/**
 * Public surface of `@flow-state-dev/claude-code/cli`: the `claude --remote`
 * dispatch block, its opt-in capability, the resolver seam, the stdout parser,
 * handle types, and typed errors.
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
