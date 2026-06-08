/**
 * Public surface of `@flow-state-dev/claude-code/sdk`: the in-process Agent SDK
 * handler block, its opt-in capability, the resolver seam, the session-continuity
 * provider, the pure translation layer, handle/event types, and typed errors.
 */
export {
  claudeCodeAgent,
  claudeAgentSessionStateSchema,
  SDK_SESSION_ID_KEY,
  SDK_AGENT_RUNS_KEY,
  type ClaudeCodeAgentOptions,
} from "./agent";
export {
  createClaudeCodeAgentCapability,
  type CreateClaudeCodeAgentCapabilityOptions,
} from "./capability";
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
  translateSdkMessage,
  type TranslateState,
} from "./translate";
export {
  createEmitState,
  emitTranslatedEvent,
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
  type ToolApprovalRequest,
  type ToolApprovalDecision,
} from "./types";
export { ClaudeAgentSdkNotInstalledError, ClaudeAgentRunError } from "./errors";

// Re-export the shared envelope so `/sdk` consumers don't need a second import.
export {
  remoteAgentTaskHandleSchema,
  type RemoteAgentTaskHandle,
  type RemoteAgentSource,
  type RemoteAgentStatus,
} from "../shared/handle";
