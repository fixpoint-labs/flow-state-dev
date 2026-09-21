/**
 * Optional index-time facet capability — composition on evaluator answers.
 *
 * When a host `uses` this, classify-on-write and facet search light up on
 * `ctx.cap["system-one-index"]`. Generators also get the search tool
 * (default-on preset). Handlers that only want the fns drop it with
 * `.presets({ tools: false })`. Omit it and those tools and fns are
 * missing — there is no silent RAG / embeddings stub. Not a System One package.
 */

import { defineCapability, type DefinedCapability } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core";
import type { EvaluateClient } from "./client";
import { type FacetQuery } from "./facets";
import {
  SEARCH_INDEXED_DOCUMENTS_TOOL,
  createSearchIndexedDocumentsTool,
} from "./index-blocks";
import {
  classifyQueryEscape,
  collectionOf,
  ingestIndexedDocument,
  reindexIndexedCollection,
  searchIndexedCollection,
  type ClassifyQueryOutput,
  type IngestInput,
  type IngestOutput,
  type ReindexInput,
  type ReindexOutput,
  type SearchOutput,
} from "./index-ops";
import { INDEXED_DOCS, indexedDocsResources } from "./indexed-docs-resource";

export interface CreateSystemOneIndexCapabilityOptions {
  client?: EvaluateClient;
  apiKey?: string;
  model?: unknown;
  /** Resource accessor. Default `"indexed-docs"`. */
  collectionKey?: string;
  schemaVersion?: number;
  minConfidence?: number;
}

export type SystemOneIndexFns = {
  ingest: (input: IngestInput) => Promise<IngestOutput>;
  search: (query: FacetQuery) => Promise<SearchOutput>;
  reindex: (input: ReindexInput) => Promise<ReindexOutput>;
  classifyQuery: (query: string) => Promise<ClassifyQueryOutput>;
};

export type SystemOneIndexCapability = DefinedCapability<"system-one-index", SystemOneIndexFns>;

/**
 * Tools a generator would see. Empty when the capability was never created
 * — that is the package-off case.
 */
export function systemOneIndexTools(
  cap: SystemOneIndexCapability | null | undefined,
  options: CreateSystemOneIndexCapabilityOptions = {},
): BlockDefinition[] {
  return cap == null ? [] : [createSearchIndexedDocumentsTool(options)];
}

/**
 * Factory for index-time classify + deterministic facet search.
 *
 * Helpers live on `ctx.cap["system-one-index"]` — not a bag glued onto
 * the capability object.
 */
export function createSystemOneIndexCapability(
  options: CreateSystemOneIndexCapabilityOptions = {},
): SystemOneIndexCapability {
  const collectionKey = options.collectionKey ?? INDEXED_DOCS;
  const searchTool = createSearchIndexedDocumentsTool(options);

  return defineCapability({
    name: "system-one-index",
    resources: indexedDocsResources,
    presets: {
      tools: { tools: [searchTool] },
      default: ["tools"],
    },
    fns: (ctx): SystemOneIndexFns => {
      const collection = collectionOf(ctx, collectionKey);
      return {
        ingest: (input) => ingestIndexedDocument(collection, input, options),
        search: (query) => searchIndexedCollection(collection, query, collectionKey),
        reindex: (input) => reindexIndexedCollection(collection, input, options),
        classifyQuery: (query) => classifyQueryEscape(query, options),
      };
    },
  });
}

export { SEARCH_INDEXED_DOCUMENTS_TOOL };
