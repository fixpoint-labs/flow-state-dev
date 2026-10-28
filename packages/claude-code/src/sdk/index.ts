/**
 * Public surface of `@flow-state-dev/claude-code/sdk`: the in-process Agent SDK
 * handler block, its opt-in capability, the resolver seam, the start-time account
 * probe and model list, the session-continuity provider, the pure translation layer, the work recorder and the two
 * collections it writes, the types of the tools `mcpTools` relays, handle/event types, and typed errors.
 */
export {
  claudeCodeAgent,
  claudeAgentSessionStateSchema,
  runNamespace,
  SDK_SESSION_ID_KEY,
  SDK_AGENT_RUNS_KEY,
  type ClaudeCodeAgentOptions,
  type SandboxSettings,
} from "./agent";
export {
  type ClaudeCodeMcpTool,
  type ClaudeCodeMcpToolServer,
  type ClaudeCodeMcpTools,
} from "./mcp-tools";
export { createClaudeCodeAgentCapability } from "./capability";
export {
  defaultResolveClaudeAgent,
  createDefaultResolveClaudeAgent,
  type SdkImporter,
} from "./sdk-client";
export {
  probeClaudeAccount,
  type ClaudeAccountProbe,
  type ProbeClaudeAccountOptions,
} from "./account-probe";
export {
  listClaudeModels,
  type ClaudeModelInfo,
  type ClaudeModelList,
  type ListClaudeModelsOptions,
} from "./model-list";
export {
  createClaudeAgentSessionProvider,
  type ClaudeAgentSession,
} from "./session";
export {
  createTranslateState,
  drainUnsettledObservations,
  translateSdkMessage,
  type TranslateState,
} from "./translate";
export {
  createEmitState,
  emitTranslatedEvent,
  closeStreamingItems,
  finalizeOpenItems,
  type EmitState,
} from "./emit";
export {
  CLAUDE_SDK_SOURCE,
  sdkAgentHandleSchema,
  type SdkAgentHandle,
  type SdkResultSubtype,
  type SdkMessageLike,
  type TranslatedEvent,
  type ResolveClaudeAgent,
  type ResolvedClaudeAgent,
  type ClaudeAgentQuery,
  type ClaudeAgentQueryOptions,
  type ClaudeAgentSettingSource,
  type ClaudeAgentSystemPrompt,
  type ToolApprovalRequest,
  type ToolApprovalDecision,
} from "./types";
export {
  OBSERVED_FILE_OPS,
  OBSERVED_PLAN,
  OBSERVED_PLAN_LIST,
  OBSERVED_GAPS,
  observedFileOpsCollection,
  observedPlanCollection,
  observedPlanListCollection,
  observedGapsCollection,
  observedFileOpStateSchema,
  observedPlanItemStateSchema,
  workRecorderResources,
  type ObservedFileOpKind,
  type ObservedOutcome,
} from "./work-collections";
export {
  createWorkRecorder,
  canonicalFilePathKey,
  type WorkRecorder,
  type WorkRecorderOptions,
  type UpsertableCollection,
} from "./work-recorder";
export { ClaudeAgentSdkNotInstalledError, ClaudeAgentRunError } from "./errors";
export { CLAUDE_CODE_HARNESS, readClaudeUsage, usageWindowOf, type ReadClaudeUsageOptions } from "./usage";

export {
  createWorkspaceAgentCapability,
  containmentSandbox,
} from "./workspace";
export type {
  WorkspaceAgentCapabilityOptions,
  WorkspaceCollectionSpec,
} from "./workspace";
export {
  WORKSPACE_OUTCOMES,
  workspaceOutcomesCollection,
  workspaceOutcomeStateSchema,
  workspaceResources,
} from "./workspace-collections";
