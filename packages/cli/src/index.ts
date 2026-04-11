/**
 * Public API surface for @flow-state-dev/cli.
 * Re-exports shared infrastructure for use by downstream commands and tools.
 */
export { program } from "./cli";
export { resolveBlock, isBlockDefinition } from "./resolve-block";
export { resolveFlow, discoverFlows, getSearchedDirs, isFlowInstance } from "./resolve-flow";
export type { DiscoverFlowsOptions } from "./resolve-flow";
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
export { registerDevCommand } from "./commands/dev";
export type { FlowRunResult, FlowEvent } from "./commands/run";
export { registerUiCommand } from "./commands/ui";
