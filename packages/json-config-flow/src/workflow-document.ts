/**
 * Versioned workflow document — a named dynamic workflow persisted as a
 * resource payload. Reuses `FlowJsonConfig` so compile/load stays one path.
 *
 * LAB / DNM: session- or org-scoped storage is a host choice; the document
 * itself is scope-agnostic JSON.
 */

import type { BlockConfig, FlowJsonConfig } from "./types";

/** Document schema version. Bump when breaking the payload shape. */
export const WORKFLOW_DOCUMENT_VERSION = 1 as const;

/**
 * Named dynamic workflow stored as a resource (or in a `WorkflowStore`).
 *
 * - `flow` is a full `FlowJsonConfig` (kind, actions, blocks, …).
 * - Convention for builder tools: a sequencer block id (often `"main"`) is
 *   the entry action’s `block`, and nested catalog configs live in `flow.blocks`.
 */
export type WorkflowDocument = {
  version: typeof WORKFLOW_DOCUMENT_VERSION;
  id: string;
  title: string;
  /** ISO timestamps for lab observability; optional for hand-authored JSON. */
  createdAt?: string;
  updatedAt?: string;
  flow: FlowJsonConfig;
};

export type CreateWorkflowDocumentInput = {
  id: string;
  title: string;
  /** Flow kind; defaults to `dynamic-workflow:<id>`. */
  kind?: string;
  /** Entry sequencer block id; defaults to `"main"`. */
  entrySequencerId?: string;
  /** Optional seed blocks (merged under `flow.blocks`). */
  blocks?: Record<string, BlockConfig>;
  /** Optional action name pointing at the entry sequencer; defaults to `"run"`. */
  entryAction?: string;
  defaultModel?: string;
  requireUser?: boolean;
};

/**
 * Build a fresh workflow document with an empty (or seeded) entry sequencer.
 */
export function createWorkflowDocument(input: CreateWorkflowDocumentInput): WorkflowDocument {
  const entrySequencerId = input.entrySequencerId ?? "main";
  const entryAction = input.entryAction ?? "run";
  const now = new Date().toISOString();

  const blocks: Record<string, BlockConfig> = {
    ...(input.blocks ?? {}),
  };

  if (blocks[entrySequencerId] === undefined) {
    blocks[entrySequencerId] = {
      type: "sequencer",
      steps: [],
    };
  } else if (blocks[entrySequencerId].type !== "sequencer") {
    throw new Error(
      `createWorkflowDocument: entry block "${entrySequencerId}" must be a sequencer (got ${blocks[entrySequencerId].type})`,
    );
  }

  const flow: FlowJsonConfig = {
    kind: input.kind ?? `dynamic-workflow:${input.id}`,
    ...(input.requireUser !== undefined ? { requireUser: input.requireUser } : { requireUser: false }),
    ...(input.defaultModel !== undefined ? { defaultModel: input.defaultModel } : {}),
    actions: {
      [entryAction]: {
        block: entrySequencerId,
        description: `Run dynamic workflow "${input.title}"`,
      },
    },
    blocks,
  };

  return {
    version: WORKFLOW_DOCUMENT_VERSION,
    id: input.id,
    title: input.title,
    createdAt: now,
    updatedAt: now,
    flow,
  };
}

export function assertWorkflowDocument(value: unknown): asserts value is WorkflowDocument {
  if (value === null || typeof value !== "object") {
    throw new Error("WorkflowDocument: expected object");
  }
  const doc = value as Record<string, unknown>;
  if (doc.version !== WORKFLOW_DOCUMENT_VERSION) {
    throw new Error(
      `WorkflowDocument: unsupported version ${String(doc.version)} (expected ${WORKFLOW_DOCUMENT_VERSION})`,
    );
  }
  if (typeof doc.id !== "string" || doc.id.length === 0) {
    throw new Error("WorkflowDocument: id must be a non-empty string");
  }
  if (typeof doc.title !== "string") {
    throw new Error("WorkflowDocument: title must be a string");
  }
  if (doc.flow === null || typeof doc.flow !== "object") {
    throw new Error("WorkflowDocument: flow must be a FlowJsonConfig object");
  }
  const flow = doc.flow as FlowJsonConfig;
  if (typeof flow.kind !== "string" || flow.kind.length === 0) {
    throw new Error("WorkflowDocument.flow.kind must be a non-empty string");
  }
  if (flow.blocks === undefined || typeof flow.blocks !== "object") {
    throw new Error("WorkflowDocument.flow.blocks must be an object");
  }
  if (flow.actions === undefined || typeof flow.actions !== "object") {
    throw new Error("WorkflowDocument.flow.actions must be an object");
  }
}

export function cloneWorkflowDocument(doc: WorkflowDocument): WorkflowDocument {
  return structuredClone(doc);
}
