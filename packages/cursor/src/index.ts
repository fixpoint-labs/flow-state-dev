/**
 * Public surface of `@flow-state-dev/cursor`: the Cursor harness block, its
 * opt-in capability, the client seam, the sandbox probe,
 * the sign-in check and its readiness check, the model list, the environment pass-list, the cost derivation, the handle and wire types,
 * and the typed errors.
 *
 * A *harness* is a coding agent driven as a block — you hand it a prompt, it
 * runs its own agentic loop in a directory, and it hands back a handle
 * describing the run. The handle's shape is the framework's, declared in
 * `@flow-state-dev/core`, so a manager driving this harness and one driving
 * Claude Code or Codex reads the same fields.
 */
export { cursorAgent, type CursorAgentOptions } from "./agent";
export { createCursorAgentCapability } from "./capability";
export { CURSOR_PASS } from "./env-pass";
export { listCursorModels, type CursorModelVariant, type ListCursorModelsOptions } from "./model-list";
export {
  createDefaultResolveCursorClient,
  type CursorSdkImporter,
} from "./cursor-client";
export { probeCursorSandbox, type CursorSandboxProbeOptions, type CursorSandboxSupport } from "./sandbox-probe";
export { checkCursorReadiness, cursorSignIn, CURSOR_SIGN_IN_REMEDY, type CursorReadinessOptions, type CursorSignIn } from "./sign-in";
export { estimateCursorCost } from "./cost";
export {
  CURSOR_SOURCE,
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
  type ResolveCursorClient,
  type ResolvedCursorClient,
} from "./types";
export {
  CursorAgentAbortedError,
  CursorAgentConfigError,
  CursorAgentRunError,
  CursorSdkNotInstalledError,
} from "./errors";
