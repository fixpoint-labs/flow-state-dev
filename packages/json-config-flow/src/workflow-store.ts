/**
 * Lab persistence for {@link WorkflowDocument}.
 *
 * **POC scope choice: in-memory `WorkflowStore` (session-lifetime for the
 * host process).** Full engine wiring via `defineResourceCollection` +
 * `ctx.resources` is sketched in {@link workflowStoreFromCollection} /
 * {@link workflowCollectionDeclaration} — prefer those when embedding in a
 * real flow. Session-scoped collection is the recommended engine mapping
 * (workflows built mid-session, discarded with the session unless the host
 * chooses `scope: "org"`).
 */

import type { WorkflowDocument } from "./workflow-document";
import { assertWorkflowDocument, cloneWorkflowDocument } from "./workflow-document";

export type WorkflowStore = {
  get(id: string): Promise<WorkflowDocument | undefined>;
  list(): Promise<WorkflowDocument[]>;
  save(doc: WorkflowDocument): Promise<WorkflowDocument>;
  delete(id: string): Promise<boolean>;
};

/**
 * Pure in-memory store used by builder tools and unit tests.
 * Not shared across processes; host owns the instance lifetime.
 */
export function createInMemoryWorkflowStore(
  seed: Iterable<WorkflowDocument> = [],
): WorkflowStore {
  const map = new Map<string, WorkflowDocument>();
  for (const doc of seed) {
    assertWorkflowDocument(doc);
    map.set(doc.id, cloneWorkflowDocument(doc));
  }

  return {
    async get(id) {
      const hit = map.get(id);
      return hit === undefined ? undefined : cloneWorkflowDocument(hit);
    },
    async list() {
      return [...map.values()].map(cloneWorkflowDocument);
    },
    async save(doc) {
      assertWorkflowDocument(doc);
      const next = cloneWorkflowDocument({
        ...doc,
        updatedAt: new Date().toISOString(),
      });
      map.set(next.id, next);
      return cloneWorkflowDocument(next);
    },
    async delete(id) {
      return map.delete(id);
    },
  };
}

/**
 * Minimal collection-shaped surface matching `ResourceCollectionRef` CRUD
 * used by the adapter. Kept structural so the lab package does not need a
 * live engine resource registry in unit tests.
 */
export type WorkflowCollectionLike = {
  /** Create instance under key (= workflow id). */
  create: (key: string, state?: WorkflowDocument) => Promise<unknown>;
  get: (key: string) => Promise<{ state: WorkflowDocument } | WorkflowDocument>;
  getOptional?: (key: string) => Promise<{ state: WorkflowDocument } | WorkflowDocument | null | undefined>;
  update?: (key: string, state: WorkflowDocument) => Promise<unknown>;
  setState?: (key: string, state: WorkflowDocument) => Promise<unknown>;
  delete?: (key: string) => Promise<unknown>;
  list?: () => Promise<Array<{ key?: string; state: WorkflowDocument } | WorkflowDocument>>;
};

function unwrapState(
  row: { state: WorkflowDocument } | WorkflowDocument,
): WorkflowDocument {
  if (row !== null && typeof row === "object" && "state" in row && (row as { state: unknown }).state !== undefined) {
    return (row as { state: WorkflowDocument }).state;
  }
  return row as WorkflowDocument;
}

/**
 * Thin adapter: map a session-/org-scoped resource collection to
 * {@link WorkflowStore}. Wire with:
 *
 * ```ts
 * // in defineFlow resources:
 * // workflows: workflowCollectionDeclaration(),
 * // then: workflowStoreFromCollection(ctx.resources.workflows)
 * ```
 */
export function workflowStoreFromCollection(collection: WorkflowCollectionLike): WorkflowStore {
  return {
    async get(id) {
      try {
        if (collection.getOptional !== undefined) {
          const row = await collection.getOptional(id);
          if (row === null || row === undefined) return undefined;
          const doc = unwrapState(row);
          assertWorkflowDocument(doc);
          return cloneWorkflowDocument(doc);
        }
        const row = await collection.get(id);
        const doc = unwrapState(row);
        assertWorkflowDocument(doc);
        return cloneWorkflowDocument(doc);
      } catch {
        return undefined;
      }
    },
    async list() {
      if (collection.list === undefined) return [];
      const rows = await collection.list();
      return rows.map((row) => {
        const doc = unwrapState(row);
        assertWorkflowDocument(doc);
        return cloneWorkflowDocument(doc);
      });
    },
    async save(doc) {
      assertWorkflowDocument(doc);
      const next = cloneWorkflowDocument({
        ...doc,
        updatedAt: new Date().toISOString(),
      });
      const existing =
        collection.getOptional !== undefined
          ? await collection.getOptional(next.id)
          : undefined;
      if (existing === null || existing === undefined) {
        // Prefer create; if it already exists some hosts throw — fall through to update.
        try {
          await collection.create(next.id, next);
          return cloneWorkflowDocument(next);
        } catch {
          // continue to update path
        }
      }
      if (collection.update !== undefined) {
        await collection.update(next.id, next);
      } else if (collection.setState !== undefined) {
        await collection.setState(next.id, next);
      } else {
        await collection.create(next.id, next);
      }
      return cloneWorkflowDocument(next);
    },
    async delete(id) {
      if (collection.delete === undefined) return false;
      try {
        await collection.delete(id);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Sketch of the `defineResourceCollection` declaration hosts should register
 * on a flow. Returned as a plain config object so this lab package does not
 * pull Zod schemas into core resource registration at import time — copy into
 * a flow module and wrap with `defineResourceCollection` + `z.object(...)`.
 *
 * **Scope:** `"session"` (recommended for POC — workflows live for the
 * session). Use `"org"` for durable shared playbooks.
 *
 * ```ts
 * import { defineResourceCollection } from "@flow-state-dev/core";
 * import { z } from "zod";
 *
 * export const workflows = defineResourceCollection({
 *   scope: "session",
 *   pattern: "workflows/*",
 *   stateSchema: z.object({
 *     version: z.literal(1),
 *     id: z.string(),
 *     title: z.string(),
 *     createdAt: z.string().optional(),
 *     updatedAt: z.string().optional(),
 *     flow: z.record(z.unknown()), // FlowJsonConfig
 *   }),
 * });
 * ```
 */
export function workflowCollectionDeclaration(): {
  scope: "session";
  pattern: "workflows/*";
  note: string;
} {
  return {
    scope: "session",
    pattern: "workflows/*",
    note:
      "LAB sketch — wrap with defineResourceCollection + Zod stateSchema matching WorkflowDocument; adapt via workflowStoreFromCollection(ctx.resources.workflows).",
  };
}
