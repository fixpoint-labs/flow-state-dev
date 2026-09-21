/**
 * Host / generator tools that build and mutate a dynamic sequencer workflow
 * document, persisting via {@link WorkflowStore} after each mutation.
 *
 * Returns `handler` blocks — the same shape generators accept as `tools`
 * (`GeneratorTool` = `BlockDefinition`).
 *
 * Invent-kill: tools only compose the fixed catalog (`map` / `http` / `tool` /
 * `sequencer` / `router` / `generator`); they do not accept arbitrary TS.
 */

import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import type { BlockConfig } from "./types";
import {
  createWorkflowDocument,
  type WorkflowDocument,
} from "./workflow-document";
import type { WorkflowStore } from "./workflow-store";

const blockConfigSchema: z.ZodType<BlockConfig> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal("sequencer"),
      steps: z.array(z.string()),
      inputSchema: z.record(z.unknown()).optional(),
      outputSchema: z.record(z.unknown()).optional(),
    }),
    z.object({
      type: z.literal("router"),
      key: z.string(),
      routes: z.record(z.string()),
      inputSchema: z.record(z.unknown()).optional(),
      outputSchema: z.record(z.unknown()).optional(),
    }),
    z.object({
      type: z.literal("generator"),
      prompt: z.string(),
      outputSchema: z.record(z.unknown()),
      model: z.string().optional(),
      inputSchema: z.record(z.unknown()).optional(),
      user: z.string().optional(),
    }),
    z.object({
      type: z.literal("map"),
      mappings: z.record(z.unknown()),
      inputSchema: z.record(z.unknown()).optional(),
      outputSchema: z.record(z.unknown()).optional(),
    }),
    z.object({
      type: z.literal("http"),
      url: z.string(),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
      headers: z.record(z.string()).optional(),
      body: z.union([z.record(z.unknown()), z.string()]).optional(),
      parseJson: z.boolean().optional(),
      inputSchema: z.record(z.unknown()).optional(),
      outputSchema: z.record(z.unknown()).optional(),
    }),
    z.object({
      type: z.literal("tool"),
      toolId: z.string(),
      args: z.record(z.unknown()).optional(),
      inputSchema: z.record(z.unknown()).optional(),
      outputSchema: z.record(z.unknown()).optional(),
    }),
  ]),
) as z.ZodType<BlockConfig>;

async function requireDoc(store: WorkflowStore, workflowId: string): Promise<WorkflowDocument> {
  const doc = await store.get(workflowId);
  if (doc === undefined) {
    throw new Error(`workflowBuilder: unknown workflow id "${workflowId}"`);
  }
  return doc;
}

function requireSequencer(doc: WorkflowDocument, sequencerId: string) {
  const block = doc.flow.blocks[sequencerId];
  if (block === undefined) {
    throw new Error(
      `workflowBuilder: sequencer "${sequencerId}" not found in workflow "${doc.id}"`,
    );
  }
  if (block.type !== "sequencer") {
    throw new Error(
      `workflowBuilder: block "${sequencerId}" is type "${block.type}", expected sequencer`,
    );
  }
  return block;
}

/**
 * Create generator-compatible tool blocks that mutate workflows in `store`.
 *
 * Typical use:
 * ```ts
 * const store = createInMemoryWorkflowStore();
 * const tools = createWorkflowBuilderTools(store);
 * generator({ tools: Object.values(tools), ... })
 * ```
 */
export function createWorkflowBuilderTools(store: WorkflowStore) {
  const createWorkflow = handler({
    name: "createWorkflow",
    description:
      "Create a new named dynamic workflow document with an empty entry sequencer and persist it.",
    inputSchema: z.object({
      id: z.string().min(1).describe("Stable workflow id"),
      title: z.string().min(1).describe("Human-readable title"),
      kind: z.string().optional(),
      entrySequencerId: z.string().optional(),
      entryAction: z.string().optional(),
      defaultModel: z.string().optional(),
    }),
    outputSchema: z.object({
      id: z.string(),
      title: z.string(),
      entrySequencerId: z.string(),
      ok: z.literal(true),
    }),
    execute: async (input) => {
      const existing = await store.get(input.id);
      if (existing !== undefined) {
        throw new Error(`createWorkflow: workflow "${input.id}" already exists`);
      }
      const doc = createWorkflowDocument({
        id: input.id,
        title: input.title,
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.entrySequencerId !== undefined
          ? { entrySequencerId: input.entrySequencerId }
          : {}),
        ...(input.entryAction !== undefined ? { entryAction: input.entryAction } : {}),
        ...(input.defaultModel !== undefined ? { defaultModel: input.defaultModel } : {}),
      });
      await store.save(doc);
      const entrySequencerId = Object.values(doc.flow.actions)[0]?.block ?? "main";
      return {
        id: doc.id,
        title: doc.title,
        entrySequencerId,
        ok: true as const,
      };
    },
  });

  const appendStep = handler({
    name: "appendWorkflowStep",
    description:
      "Append a catalog block to a sequencer and register its config in the workflow catalog. Persists after mutation.",
    inputSchema: z.object({
      workflowId: z.string().min(1),
      sequencerId: z.string().min(1).default("main"),
      stepId: z.string().min(1).describe("New block id to append and register"),
      block: blockConfigSchema.describe("Catalog block config (map/http/tool/…)"),
    }),
    outputSchema: z.object({
      workflowId: z.string(),
      sequencerId: z.string(),
      steps: z.array(z.string()),
      ok: z.literal(true),
    }),
    execute: async (input) => {
      const doc = await requireDoc(store, input.workflowId);
      const sequencerId = input.sequencerId ?? "main";
      const seq = requireSequencer(doc, sequencerId);

      if (doc.flow.blocks[input.stepId] !== undefined && input.stepId !== sequencerId) {
        // Allow re-registering the same step id only when replacing config in place.
        // Append still adds the id to steps if missing.
      }
      if (seq.steps.includes(input.stepId)) {
        throw new Error(
          `appendWorkflowStep: step "${input.stepId}" already on sequencer "${sequencerId}"`,
        );
      }

      doc.flow.blocks[input.stepId] = input.block as BlockConfig;
      seq.steps = [...seq.steps, input.stepId];
      doc.flow.blocks[sequencerId] = seq;
      doc.updatedAt = new Date().toISOString();
      await store.save(doc);

      return {
        workflowId: doc.id,
        sequencerId,
        steps: [...seq.steps],
        ok: true as const,
      };
    },
  });

  const replaceSteps = handler({
    name: "replaceWorkflowSteps",
    description:
      "Replace a sequencer’s step list and optionally upsert nested block configs. Persists after mutation.",
    inputSchema: z.object({
      workflowId: z.string().min(1),
      sequencerId: z.string().min(1).default("main"),
      steps: z.array(z.string()).min(1),
      blocks: z.record(blockConfigSchema).optional(),
    }),
    outputSchema: z.object({
      workflowId: z.string(),
      sequencerId: z.string(),
      steps: z.array(z.string()),
      ok: z.literal(true),
    }),
    execute: async (input) => {
      const doc = await requireDoc(store, input.workflowId);
      const sequencerId = input.sequencerId ?? "main";
      const seq = requireSequencer(doc, sequencerId);

      if (input.blocks !== undefined) {
        for (const [id, cfg] of Object.entries(input.blocks)) {
          doc.flow.blocks[id] = cfg as BlockConfig;
        }
      }

      for (const stepId of input.steps) {
        if (doc.flow.blocks[stepId] === undefined) {
          throw new Error(
            `replaceWorkflowSteps: step "${stepId}" has no block config — pass blocks.${stepId} or append first`,
          );
        }
      }

      seq.steps = [...input.steps];
      doc.flow.blocks[sequencerId] = seq;
      doc.updatedAt = new Date().toISOString();
      await store.save(doc);

      return {
        workflowId: doc.id,
        sequencerId,
        steps: [...seq.steps],
        ok: true as const,
      };
    },
  });

  const setEntryAction = handler({
    name: "setWorkflowEntryAction",
    description: "Point a named flow action at a block (usually the entry sequencer). Persists.",
    inputSchema: z.object({
      workflowId: z.string().min(1),
      actionName: z.string().min(1).default("run"),
      blockId: z.string().min(1),
      description: z.string().optional(),
    }),
    outputSchema: z.object({
      workflowId: z.string(),
      actionName: z.string(),
      blockId: z.string(),
      ok: z.literal(true),
    }),
    execute: async (input) => {
      const doc = await requireDoc(store, input.workflowId);
      const actionName = input.actionName ?? "run";
      if (doc.flow.blocks[input.blockId] === undefined) {
        throw new Error(
          `setWorkflowEntryAction: block "${input.blockId}" not in workflow "${doc.id}"`,
        );
      }
      doc.flow.actions[actionName] = {
        block: input.blockId,
        ...(input.description !== undefined ? { description: input.description } : {}),
      };
      doc.updatedAt = new Date().toISOString();
      await store.save(doc);
      return {
        workflowId: doc.id,
        actionName,
        blockId: input.blockId,
        ok: true as const,
      };
    },
  });

  const getWorkflow = handler({
    name: "getWorkflow",
    description: "Read a saved workflow document by id (for planning / verification).",
    inputSchema: z.object({
      workflowId: z.string().min(1),
    }),
    outputSchema: z.object({
      found: z.boolean(),
      document: z.unknown().optional(),
    }),
    execute: async (input) => {
      const doc = await store.get(input.workflowId);
      if (doc === undefined) {
        return { found: false as const };
      }
      return { found: true as const, document: doc };
    },
  });

  return {
    createWorkflow,
    appendStep,
    replaceSteps,
    setEntryAction,
    getWorkflow,
  };
}

export type WorkflowBuilderTools = ReturnType<typeof createWorkflowBuilderTools>;
