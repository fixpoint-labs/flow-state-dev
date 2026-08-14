/**
 * Public surface of `@flow-state-dev/claude-code/sdk`: everything in this
 * package that reaches Claude Code through the in-process Agent SDK. Two
 * invocation modes live here:
 *
 * - **flow-shaped** — `claudeCodeAgent`, a handler block that runs the SDK loop
 *   while emitting FSD items, with its capability, session-continuity provider,
 *   and the pure translation layer behind it.
 * - **headless run** — `runClaudeHeadless`, blocking, cwd-scoped, reporting the
 *   terminal subtype, cost and usage. A plain function, not a block, so a caller
 *   outside a flow can use it.
 *
 * Both go through the same resolver seam, so there is one place the SDK is
 * loaded and one place that mocks.
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
  defaultResolveClaudeAgentQuery,
  createResolveClaudeAgentQuery,
  type SdkImporter,
} from "./sdk-client";
export {
  runClaudeHeadless,
  type ClaudeHeadlessResult,
  type ClaudeHeadlessUsage,
  type RunClaudeHeadlessOptions,
} from "./headless";
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
  type ResolveClaudeAgentQuery,
  type ResolvedClaudeAgent,
  type ClaudeAgentQuery,
  type ClaudeAgentQueryOptions,
  type ClaudeSettingSource,
  type ClaudeSystemPrompt,
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
