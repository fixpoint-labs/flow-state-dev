/**
 * Indexed-document collection — resource leaf (BP-019).
 *
 * Facets live on resource state, the mutable lane. This is not
 * `references/` and not query-time RAG. Schema is open in the POC:
 * add a field here, bump `FACET_SCHEMA_VERSION`, and reindex.
 */

import { defineResourceCollection } from "@flow-state-dev/core";
import type { DeclaredResourceEntry } from "@flow-state-dev/core/types";
import { z } from "zod";

/** Accessor key and storage prefix. One string on purpose. */
export const INDEXED_DOCS = "indexed-docs" as const;

/** Bump when the facet shape changes so stored rows reclassify. */
export const FACET_SCHEMA_VERSION = 1;

export const documentKindSchema = z.enum(["ticket", "note", "spec", "other"]);
export const documentTopicSchema = z.enum(["billing", "launch", "infra", "other"]);
export const documentStatusSchema = z.enum(["open", "closed", "unknown"]);
export const documentUrgencySchema = z.enum(["low", "normal", "high"]);

export const indexedDocumentFacetsSchema = z.object({
  kind: documentKindSchema.nullable().default(null),
  topic: documentTopicSchema.nullable().default(null),
  status: documentStatusSchema.nullable().default(null),
  urgency: documentUrgencySchema.nullable().default(null),
  classifiedAt: z.string().nullable().default(null),
  contentHash: z.string().nullable().default(null),
  schemaVersion: z.number().nullable().default(null),
});

export const indexedDocumentStateSchema = z.object({
  title: z.string(),
  body: z.string(),
  facets: indexedDocumentFacetsSchema.nullable().default(null),
});

export type DocumentKind = z.infer<typeof documentKindSchema>;
export type DocumentTopic = z.infer<typeof documentTopicSchema>;
export type DocumentStatus = z.infer<typeof documentStatusSchema>;
export type DocumentUrgency = z.infer<typeof documentUrgencySchema>;
export type IndexedDocumentFacets = z.infer<typeof indexedDocumentFacetsSchema>;
export type IndexedDocumentState = z.infer<typeof indexedDocumentStateSchema>;

/**
 * User-scoped collection. Shared across flows (BP-027). Facets are
 * mutable resource state, not a RO reference dump.
 */
export const indexedDocsCollection = defineResourceCollection({
  pattern: `${INDEXED_DOCS}/*`,
  scope: "user",
  stateSchema: indexedDocumentStateSchema,
  client: {
    state: { read: true },
    expose: ["title", "body", "facets"],
  },
});

export const indexedDocsResources: Record<string, DeclaredResourceEntry> = {
  [INDEXED_DOCS]: indexedDocsCollection,
};
