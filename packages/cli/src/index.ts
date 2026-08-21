/**
 * Public API surface for @flow-state-dev/fsdev.
 * Re-exports shared infrastructure for use by downstream commands and tools.
 */
export { program } from "./cli";
export { resolveBlock, isBlockDefinition } from "./resolve-block";
export { resolveFlow, discoverFlows, getSearchedDirs, isFlowInstance } from "./resolve-flow";
export type { DiscoverFlowsOptions, FlowImportFailure } from "./resolve-flow";
export { loadFsdevConfig } from "./load-config";
export type { LoadConfigOptions, LoadedConfig } from "./load-config";
export { parseInputArg } from "./parse-input";
export { formatOutput } from "./format-output";
export {
  EXIT_SUCCESS,
  EXIT_EXECUTION_ERROR,
  EXIT_INVALID_ARGS,
  EXIT_CONFIG_ERROR,
  EXIT_DISCOVERY_ERROR,
  EXIT_SCAFFOLD_ERROR,
  EXIT_INTERNAL_ERROR,
} from "./exit-codes";
export type { BlockExecResult } from "./commands/block";
export { registerDevCommand, executeDevCommand } from "./commands/dev";
export type { FlowRunResult, FlowEvent } from "./commands/run";
export { registerServeCommand, executeServeCommand } from "./commands/serve";
export { registerChatCommand, executeChatCommand } from "./commands/chat";
export type { ChatCommandOptions } from "./commands/chat";
export type { ParsedInput } from "./chat/parse";
export type { FlowActionTarget } from "./chat/targets";
export type { ChatRenderer } from "./chat/render";
export { registerUiCommand } from "./commands/ui";
// Three names, not six. A shipper embeds the block, renders it, and asserts its own copy —
// the command-form table and the comparison verdict are how `renderNextSteps` and
// `assertCanonicalNextSteps` do their jobs, and publishing them would make narrowing this
// surface a breaking change later (BP-004).
export { CANONICAL_NEXT_STEPS, renderNextSteps, assertCanonicalNextSteps } from "./next-steps";
export type {
  NextStepsTopology,
  NextStepsPackageManager,
  NextStepsValues,
  RenderNextStepsOptions,
} from "./next-steps";
