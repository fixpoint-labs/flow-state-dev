/**
 * Public surface of `@flow-state-dev/claude-code/sdk`: the in-process Agent SDK
 * handler block, its opt-in capability, the resolver seam, the session-continuity
 * provider, the pure translation layer, the work recorder and the two
 * collections it writes, handle/event types, and typed errors.
 */
export {
  claudeCodeAgent,
  claudeAgentSessionStateSchema,
  runNamespace,
  SDK_SESSION_ID_KEY,
  SDK_AGENT_RUNS_KEY,
  type ClaudeCodeAgentOptions,
} from "./agent";
export { createClaudeCodeAgentCapability } from "./capability";
export {
  defaultResolveClaudeAgent,
  createDefaultResolveClaudeAgent,
  type SdkImporter,
} from "./sdk-client";
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
  type ToolApprovalRequest,
  type ToolApprovalDecision,
} from "./types";
export {
  OBSERVED_FILE_OPS,
  OBSERVED_PLAN,
  OBSERVED_GAPS,
  observedFileOpsCollection,
  observedPlanCollection,
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

// Re-export the shared envelope so `/sdk` consumers don't need a second import.
export {
  remoteAgentTaskHandleSchema,
  type RemoteAgentTaskHandle,
  type RemoteAgentSource,
  type RemoteAgentStatus,
} from "../shared/handle";

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
