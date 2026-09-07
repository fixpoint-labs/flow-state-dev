/**
 * Public surface of `@flow-state-dev/cursor`: the Cursor harness block, its
 * opt-in capability, the client seam and its version gate, the pure translation
 * layer, the cost derivation, the handle and wire types, and the typed errors.
 *
 * A *harness* is a coding agent driven as a block — you hand it a prompt, it
 * runs its own agentic loop in a directory, and it hands back a handle
 * describing the run. The handle's shape is the framework's, declared in
 * `@flow-state-dev/core`, so a manager driving this harness and one driving
 * Claude Code or Codex reads the same fields.
 */
export { cursorAgent, type CursorAgentOptions } from "./agent";
export { createCursorAgentCapability } from "./capability";
export {
  assertTestedSdkVersion,
  createDefaultResolveCursorClient,
  readInstalledCursorSdkVersion,
  type CursorSdkImporter,
} from "./cursor-client";
export { translateCursorMessage } from "./translate";
export { estimateCursorCost } from "./cost";
export {
  createEmitState,
  emitTranslatedEvent,
  finalizeOpenItems,
  type EmitState,
} from "./emit";
export {
  CURSOR_SOURCE,
  TESTED_SDK_VERSION,
  cursorAgentHandleSchema,
  type CursorAgentHandle,
  type CursorAgentLike,
  type CursorContentBlock,
  type CursorCreateOptions,
  type CursorModelSelection,
  type CursorRunError,
  type CursorRunLike,
  type CursorRunResult,
  type CursorRunUsage,
  type CursorSdkMessage,
  type CursorSendOptions,
  type CursorWireUsage,
  type InstalledSdkVersion,
  type InstalledSdkVersionReader,
  type ResolveCursorClient,
  type ResolvedCursorClient,
  type TranslatedEvent,
} from "./types";
export {
  CursorAgentAbortedError,
  CursorAgentConfigError,
  CursorAgentRunError,
  CursorSdkNotInstalledError,
  CursorSdkVersionMismatchError,
} from "./errors";
