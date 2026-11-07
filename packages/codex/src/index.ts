/**
 * Public surface of `@flow-state-dev/codex`: the Codex harness block, its
 * opt-in capability, the client seam, the cost derivation, the usage read, the environment pass-list, the start-time account probe and its readiness check, the model list, the handle and wire types, and the
 * typed errors.
 *
 * A *harness* is a coding agent driven as a block — you hand it a prompt, it
 * runs its own agentic loop in a directory, and it hands back a handle
 * describing the run. The handle's shape is the framework's, declared in
 * `@flow-state-dev/core`, so a manager driving this harness and one driving
 * Claude Code reads the same fields.
 */
export { codexAgent, type CodexAgentOptions } from "./agent";
export { CODEX_PASS } from "./env-pass";
export { createCodexAgentCapability } from "./capability";
export {
  createDefaultResolveCodexClient,
  type CodexSdkImporter,
} from "./codex-client";
export { estimateCodexCost } from "./cost";
export { findCodexProgram, readCodexUsage, type CodexProgram, type ReadCodexUsageOptions } from "./usage";
export { listCodexModels, type ListCodexModelsOptions } from "./model-list";
export {
  checkCodexReadiness,
  CODEX_SIGN_IN_REMEDY,
  probeCodexAccount,
  type CodexAccountProbe,
  type CodexReadinessOptions,
  type ProbeCodexAccountOptions,
} from "./account-probe";
export {
  CODEX_SOURCE,
  codexAgentHandleSchema,
  type CodexAgentHandle,
  type CodexClientOptions,
  type CodexFileUpdateChange,
  type CodexRunUsage,
  type CodexThreadEvent,
  type CodexThreadItem,
  type CodexThreadLike,
  type CodexThreadOptions,
  type CodexWireUsage,
  type ResolveCodexClient,
  type ResolvedCodexClient,
} from "./types";
export {
  CodexAgentAbortedError,
  CodexAgentConfigError,
  CodexAgentRunError,
  CodexSdkNotInstalledError,
} from "./errors";
