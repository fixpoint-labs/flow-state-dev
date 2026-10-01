/**
 * Public surface of `@flow-state-dev/claude-code/cli`: the resolver seam for
 * hosts that run the local `claude` binary themselves, plus the shared handle
 * envelope.
 */
export {
  defaultResolveClaudeCli,
  defaultClaudeCliExec,
  type ResolveClaudeCli,
  type ResolvedClaudeCli,
  type ClaudeCliExec,
  type ClaudeCliExecOptions,
  type ClaudeCliExecResult,
} from "./resolve-cli";

// Re-export the shared envelope so `/cli` consumers don't need a second import.
export {
  remoteAgentTaskHandleSchema,
  type RemoteAgentTaskHandle,
  type RemoteAgentSource,
  type RemoteAgentStatus,
} from "../shared";
