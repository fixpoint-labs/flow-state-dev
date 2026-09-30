/**
 * Load a saved workflow from a store, compile with the existing JSON catalog
 * loader, and optionally execute the entry sequencer.
 */

import { asRuntime, type BlockContext, type BlockDefinition } from "@flow-state-dev/core/types";
import type { FlowType } from "@flow-state-dev/core";
import { compileAllBlocks, loadFlowFromJson, type CompiledBlocks } from "./compile-block";
import type { LoadFlowOptions } from "./types";
import type { WorkflowDocument } from "./workflow-document";
import type { WorkflowStore } from "./workflow-store";

export type LoadedSavedWorkflow = {
  document: WorkflowDocument;
  /** `defineFlow` factory from {@link loadFlowFromJson}. */
  flow: FlowType<any, any, any, any, any, any, any>;
  compiled: CompiledBlocks;
  entryBlock: BlockDefinition<any, any>;
  actionName: string;
};

export type RunSavedWorkflowOptions = {
  /** Action name on the stored flow; defaults to `"run"`. */
  action?: string;
  /**
   * When set, invoke the entry block with this context (e.g. test mock ctx).
   * Uses core `asRuntime(block).run` — no engine required.
   */
  ctx?: BlockContext;
  /**
   * When true (default if `ctx` is provided), execute and return `output`.
   * When false, only compile/load.
   */
  execute?: boolean;
};

/**
 * Load + compile a saved workflow. Does not execute unless `opts.ctx` is set
 * (or `opts.execute === true` with `ctx`).
 */
export async function loadSavedWorkflow(
  store: WorkflowStore,
  id: string,
  loadOptions: LoadFlowOptions = {},
  action = "run",
): Promise<LoadedSavedWorkflow> {
  const document = await store.get(id);
  if (document === undefined) {
    throw new Error(`runSavedWorkflow: no workflow with id "${id}"`);
  }

  const actionDef = document.flow.actions[action];
  if (actionDef === undefined) {
    throw new Error(
      `runSavedWorkflow: workflow "${id}" has no action "${action}". ` +
        `Known: ${Object.keys(document.flow.actions).join(", ") || "(none)"}`,
    );
  }

  // Empty sequencer is allowed while building; refuse to compile/run until steps exist.
  const entryCfg = document.flow.blocks[actionDef.block];
  if (
    entryCfg !== undefined &&
    entryCfg.type === "sequencer" &&
    (!Array.isArray(entryCfg.steps) || entryCfg.steps.length === 0)
  ) {
    throw new Error(
      `runSavedWorkflow: entry sequencer "${actionDef.block}" has no steps — append catalog blocks first`,
    );
  }

  const flow = loadFlowFromJson(document.flow, loadOptions);
  const compiled = compileAllBlocks(document.flow, loadOptions);
  const entryBlock = compiled[actionDef.block];
  if (entryBlock === undefined) {
    throw new Error(
      `runSavedWorkflow: compiled graph missing entry block "${actionDef.block}"`,
    );
  }

  return {
    document,
    flow,
    compiled,
    entryBlock,
    actionName: action,
  };
}

/**
 * Load a saved workflow by id, compile with `loadFlowFromJson` /
 * `compileAllBlocks`, and (when `ctx` is provided) execute the entry
 * sequencer — suitable for unit tests without a full engine.
 */
export async function runSavedWorkflow(
  store: WorkflowStore,
  id: string,
  input: unknown,
  loadOptions: LoadFlowOptions = {},
  opts: RunSavedWorkflowOptions = {},
): Promise<LoadedSavedWorkflow & { output?: unknown }> {
  const loaded = await loadSavedWorkflow(store, id, loadOptions, opts.action ?? "run");
  const shouldExecute = opts.execute ?? opts.ctx !== undefined;

  if (!shouldExecute) {
    return loaded;
  }

  if (opts.ctx === undefined) {
    throw new Error(
      "runSavedWorkflow: execute requested but no BlockContext provided (pass opts.ctx, e.g. createMockContext())",
    );
  }

  const output = await asRuntime(loaded.entryBlock).run(input, opts.ctx);
  return { ...loaded, output };
}
