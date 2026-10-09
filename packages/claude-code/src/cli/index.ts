/**
 * Public surface of `@flow-state-dev/claude-code/cli`: the resolver seam for
 * hosts that run the local `claude` binary themselves.
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
