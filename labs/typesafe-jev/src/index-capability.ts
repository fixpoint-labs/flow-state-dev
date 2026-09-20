/**
 * Optional System One index capability.
 *
 * When a host `uses` this, classify-on-write and facet search light up.
 * When the package is absent, those tools are missing — there is no
 * silent RAG / embeddings stub. Core would own this seam later; the lab
 * owns the sketch.
 */

import { defineCapability, type DefinedCapability } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core";
import type { TypeSafeDecisionsClient } from "./client";
import {
  classifyOnWrite,
  classifyQuery,
  createSearchIndexedDocumentsTool,
  reindexIndexedDocuments,
  searchIndexedDocuments,
  SEARCH_INDEXED_DOCUMENTS_TOOL,
} from "./index-blocks";
import {
  INDEXED_DOCS,
  indexedDocsCollection,
  indexedDocsResources,
} from "./indexed-docs-resource";
import { filterByFacets, hashIndexedContent, needsReindex } from "./facets";

export interface CreateSystemOneIndexCapabilityOptions {
  client?: TypeSafeDecisionsClient;
  apiKey?: string;
  /** Resource accessor. Default `"indexed-docs"`. */
  collectionKey?: string;
  schemaVersion?: number;
  minConfidence?: number;
}

export interface SystemOneIndexCapability extends DefinedCapability {
  readonly collectionKey: string;
  readonly collection: typeof indexedDocsCollection;
  readonly searchTool: BlockDefinition;
  readonly classifyOnWrite: ReturnType<typeof classifyOnWrite>;
  readonly searchIndexed: ReturnType<typeof searchIndexedDocuments>;
  readonly reindex: ReturnType<typeof reindexIndexedDocuments>;
  readonly classifyQuery: ReturnType<typeof classifyQuery>;
  readonly filterByFacets: typeof filterByFacets;
  readonly needsReindex: typeof needsReindex;
  readonly hashIndexedContent: typeof hashIndexedContent;
}

/**
 * Tools a generator would see. Empty when the capability was never created
 * — that is the package-off case.
 */
export function systemOneIndexTools(
  cap: SystemOneIndexCapability | null | undefined,
): BlockDefinition[] {
  return cap == null ? [] : [cap.searchTool];
}

/**
 * Factory for the future `@flow-state-dev/system-one` index surface.
 */
export function createSystemOneIndexCapability(
  options: CreateSystemOneIndexCapabilityOptions = {},
): SystemOneIndexCapability {
  const collectionKey = options.collectionKey ?? INDEXED_DOCS;
  const searchTool = createSearchIndexedDocumentsTool(options);
  const classify = classifyOnWrite(options);
  const search = searchIndexedDocuments(options);
  const reindex = reindexIndexedDocuments(options);
  const query = classifyQuery(options);

  const cap = defineCapability({
    name: "system-one-index",
    resources: indexedDocsResources,
    presets: {
      tools: { tools: [searchTool] },
      default: ["tools"],
    },
  });

  return Object.assign(cap, {
    collectionKey,
    collection: indexedDocsCollection,
    searchTool,
    classifyOnWrite: classify,
    searchIndexed: search,
    reindex,
    classifyQuery: query,
    filterByFacets,
    needsReindex,
    hashIndexedContent,
  });
}

export { SEARCH_INDEXED_DOCUMENTS_TOOL };
