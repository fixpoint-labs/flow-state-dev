/**
 * Public surface of `@flow-state-dev/codex`: the Codex harness block, its
 * opt-in capability, the client seam and its version gate, the pure
 * translation layer, the cost derivation, the handle and wire types, and the
 * typed errors.
 *
 * A *harness* is a coding agent driven as a block — you hand it a prompt, it
 * runs its own agentic loop in a directory, and it hands back a handle
 * describing the run. The handle's shape is the framework's, declared in
 * `@flow-state-dev/core`, so a manager driving this harness and one driving
 * Claude Code reads the same fields.
 */
export { codexAgent, type CodexAgentOptions } from "./agent";
export { createCodexAgentCapability } from "./capability";
export {
  assertTestedSdkVersion,
  createDefaultResolveCodexClient,
  readInstalledCodexSdkVersion,
  type CodexSdkImporter,
} from "./codex-client";
export { translateCodexEvent } from "./translate";
export { estimateCodexCost } from "./cost";
export {
  createEmitState,
  emitTranslatedEvent,
  finalizeOpenItems,
  type EmitState,
} from "./emit";
export {
  CODEX_SOURCE,
  TESTED_SDK_VERSION,
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
  type InstalledSdkVersionReader,
  type ResolveCodexClient,
  type ResolvedCodexClient,
  type TranslatedEvent,
} from "./types";
export {
  CodexAgentAbortedError,
  CodexAgentConfigError,
  CodexAgentRunError,
  CodexSdkNotInstalledError,
  CodexSdkVersionMismatchError,
} from "./errors";
