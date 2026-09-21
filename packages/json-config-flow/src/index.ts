/**
 * @flow-state-dev/json-config-flow — LAB / DO NOT MERGE
 *
 * Proof that an entire FSD workflow can be assembled from JSON config alone,
 * by compiling a **fixed** catalog of block kinds into real core blocks
 * (`sequencer`, `utility.keyedRouter`, `generator`, `handler`).
 *
 * Invent-kill: this does **not** replace TypeScript for novel block types.
 * New primitives still need TS; this package only composes the catalog.
 */
export { loadFlowFromJson, compileAllBlocks, compileBlockById } from "./compile-block";
export type { CompiledBlocks } from "./compile-block";
export { jsonSchemaToZod } from "./json-schema-to-zod";
export {
  applyMappings,
  getAtPath,
  interpolateTemplate,
  isPathExpression,
  pathSegments,
  resolveMappingValue,
} from "./path";
export type {
  BlockConfig,
  FlowJsonAction,
  FlowJsonConfig,
  GeneratorBlockConfig,
  HostTool,
  HttpBlockConfig,
  JsonSchema,
  LoadFlowOptions,
  MapBlockConfig,
  RouterBlockConfig,
  SequencerBlockConfig,
  ToolBlockConfig,
} from "./types";
