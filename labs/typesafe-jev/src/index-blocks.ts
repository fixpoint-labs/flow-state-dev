/**
 * Handler / tool wrappers over the index-time ops.
 *
 * The capability owns the `ctx.cap` functions. These blocks exist so a
 * flow can hang ingest / search / reindex on actions, and so a generator
 * can get `searchIndexedDocuments` as a tool.
 */

import { handler, type BlockDefinition } from "@flow-state-dev/core";
import type { TypeSafeDecisionsClient } from "./client";
import { type FacetQuery } from "./facets";
import { INDEXED_DOCS, indexedDocsResources } from "./indexed-docs-resource";
import {
  classifyQueryEscape,
  classifyQueryInputSchema,
  classifyQueryOutputSchema,
  collectionOf,
  ingestIndexedDocument,
  ingestInputSchema,
  ingestOutputSchema,
  reindexIndexedCollection,
  reindexInputSchema,
  reindexOutputSchema,
  searchIndexedCollection,
  searchInputSchema,
  searchOutputSchema,
  type ClassifyQueryInput,
  type ClassifyQueryOutput,
  type IngestInput,
  type IngestOutput,
  type ReindexInput,
  type ReindexOutput,
  type SearchInput,
  type SearchOutput,
} from "./index-ops";

export interface IndexBlockOptions {
  client?: TypeSafeDecisionsClient;
  apiKey?: string;
  collectionKey?: string;
  schemaVersion?: number;
  minConfidence?: number;
}

export type {
  ClassifyQueryInput,
  ClassifyQueryOutput,
  IngestInput,
  IngestOutput,
  ReindexInput,
  ReindexOutput,
  SearchInput,
  SearchOutput,
};

/** Write (or update) a document and classify it into resource-state facets. */
export function classifyOnWrite(options: IndexBlockOptions = {}) {
  const collectionKey = options.collectionKey ?? INDEXED_DOCS;

  return handler({
    name: "classifyOnWrite",
    description: "Write a document and classify facets onto its resource state.",
    inputSchema: ingestInputSchema,
    outputSchema: ingestOutputSchema,
    resources: indexedDocsResources,
    execute: async (input, ctx): Promise<IngestOutput> =>
      ingestIndexedDocument(collectionOf(ctx, collectionKey), input, options),
  });
}

/**
 * Deterministic facet filter. Lists stored rows and matches the query.
 * Does not call Decisions.
 */
export function searchIndexedDocuments(options: IndexBlockOptions = {}) {
  const collectionKey = options.collectionKey ?? INDEXED_DOCS;

  return handler({
    name: "searchIndexedDocuments",
    description:
      "Filter indexed documents by stored facets. Deterministic — does not call a model.",
    inputSchema: searchInputSchema,
    outputSchema: searchOutputSchema,
    resources: indexedDocsResources,
    execute: async (input, ctx): Promise<SearchOutput> =>
      searchIndexedCollection(collectionOf(ctx, collectionKey), input as FacetQuery, collectionKey),
  });
}

/** Walk the collection and reclassify rows whose content or schema is stale. */
export function reindexIndexedDocuments(options: IndexBlockOptions = {}) {
  const collectionKey = options.collectionKey ?? INDEXED_DOCS;

  return handler({
    name: "reindexIndexedDocuments",
    description: "Reclassify indexed documents whose content or facet schema changed.",
    inputSchema: reindexInputSchema,
    outputSchema: reindexOutputSchema,
    resources: indexedDocsResources,
    execute: async (input, ctx): Promise<ReindexOutput> =>
      reindexIndexedCollection(collectionOf(ctx, collectionKey), input, options),
  });
}

/**
 * Query-time classify. Escape hatch only — search does not use this.
 */
export function classifyQuery(options: IndexBlockOptions = {}) {
  return handler({
    name: "classifyQuery",
    description:
      "Escape hatch: classify a search string into a facet filter. Not the happy path.",
    inputSchema: classifyQueryInputSchema,
    outputSchema: classifyQueryOutputSchema,
    execute: async (input: ClassifyQueryInput): Promise<ClassifyQueryOutput> =>
      classifyQueryEscape(input.query, options),
  });
}

/** Tool name generators see when the System One index capability is on. */
export const SEARCH_INDEXED_DOCUMENTS_TOOL = "searchIndexedDocuments";

/** Generator tool the capability installs. Same handler as the search action. */
export function createSearchIndexedDocumentsTool(
  options: IndexBlockOptions = {},
): BlockDefinition<typeof searchInputSchema, typeof searchOutputSchema> {
  return searchIndexedDocuments(options);
}
