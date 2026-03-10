/**
 * Public API surface for @flow-state-dev/cli.
 * Re-exports shared infrastructure for use by downstream commands and tools.
 */
export { program } from "./cli.js";
export { resolveBlock, isBlockDefinition } from "./resolve-block.js";
export { resolveFlow, discoverFlows, getSearchedDirs, isFlowInstance } from "./resolve-flow.js";
export type { DiscoverFlowsOptions } from "./resolve-flow.js";
export { parseInputArg } from "./parse-input.js";
export { formatOutput } from "./format-output.js";
export { EXIT_SUCCESS, EXIT_EXECUTION_ERROR, EXIT_INVALID_ARGS } from "./exit-codes.js";
export type { BlockExecResult } from "./commands/block.js";
export type { FlowRunResult, FlowEvent } from "./commands/run.js";
