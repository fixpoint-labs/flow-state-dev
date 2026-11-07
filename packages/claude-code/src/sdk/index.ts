/**
 * Public surface of `@flow-state-dev/claude-code`: the in-process Agent SDK
 * handler block, its opt-in capability, the resolver seam, the start-time
 * account probe and model list, the environment pass-list a run needs, the
 * readiness check, the session-continuity provider, the work recorder and
 * the two collections it writes, the workspace capability, the types of the
 * tools `mcpTools` relays, handle and wire types, and typed errors.
 *
 * Every name here carries the package's name (`ClaudeCode`, `claudeCode`,
 * `CLAUDE_CODE_`), as Codex's and Cursor's carry theirs. Shapes every harness
 * shares (the plan record, the model list, the readiness answer) are core's,
 * on `@flow-state-dev/core/harness`.
 */
export {
  claudeCodeAgent,
  claudeCodeSessionStateSchema,
  CLAUDE_CODE_SESSION_ID_KEY,
  CLAUDE_CODE_AGENT_RUNS_KEY,
  type ClaudeCodeAgentOptions,
  type ClaudeCodeSandboxSettings,
} from "./agent";
export {
  type ClaudeCodeMcpTool,
  type ClaudeCodeMcpToolServer,
  type ClaudeCodeMcpTools,
} from "./mcp-tools";
export { createClaudeCodeAgentCapability } from "./capability";
export {
  defaultResolveClaudeCodeAgent,
  createDefaultResolveClaudeCodeAgent,
  type ClaudeCodeSdkImporter,
} from "./sdk-client";
export {
  checkClaudeCodeReadiness,
  type ClaudeCodeReadinessOptions,
  CLAUDE_CODE_SIGN_IN_REMEDY,
  probeClaudeCodeAccount,
  type ClaudeCodeAccountProbe,
  type ProbeClaudeCodeAccountOptions,
} from "./account-probe";
export { CLAUDE_CODE_PASS } from "./env-pass";
export {
  listClaudeCodeModels,
  type ListClaudeCodeModelsOptions,
} from "./model-list";
export {
  createClaudeCodeSessionProvider,
  type ClaudeCodeSession,
} from "./session";
export {
  CLAUDE_CODE_SOURCE,
  claudeCodeAgentHandleSchema,
  type ClaudeCodeAgentHandle,
  type ClaudeCodeResultSubtype,
  type ClaudeCodeSdkMessage,
  type ResolveClaudeCodeAgent,
  type ResolvedClaudeCodeAgent,
  type ClaudeCodeQuery,
  type ClaudeCodeQueryOptions,
  type ClaudeCodeSettingSource,
  type ClaudeCodeSystemPrompt,
  type ClaudeCodeToolApprovalRequest,
  type ClaudeCodeToolApprovalDecision,
} from "./types";
export {
  CLAUDE_CODE_FILE_OPS,
  CLAUDE_CODE_GAPS,
  claudeCodeFileOpsCollection,
  claudeCodeGapsCollection,
  claudeCodeFileOpStateSchema,
  claudeCodeWorkRecorderResources,
  type ClaudeCodeFileOpKind,
} from "./work-collections";
export {
  createClaudeCodeWorkRecorder,
  type ClaudeCodeWorkRecorder,
  type ClaudeCodeWorkRecorderOptions,
} from "./work-recorder";
export { ClaudeCodeSdkNotInstalledError, ClaudeCodeAgentRunError, ClaudeCodeAgentAbortedError } from "./errors";
export { CLAUDE_CODE_HARNESS, readClaudeCodeUsage, type ReadClaudeCodeUsageOptions } from "./usage";

export {
  createClaudeCodeWorkspaceCapability,
  claudeCodeContainmentSandbox,
} from "./workspace";
export type {
  ClaudeCodeWorkspaceCapabilityOptions,
  ClaudeCodeWorkspaceCollectionSpec,
} from "./workspace";
export {
  CLAUDE_CODE_WORKSPACE_OUTCOMES,
  claudeCodeWorkspaceOutcomesCollection,
  claudeCodeWorkspaceOutcomeStateSchema,
  claudeCodeWorkspaceResources,
} from "./workspace-collections";
