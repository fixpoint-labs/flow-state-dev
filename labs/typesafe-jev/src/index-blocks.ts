/**
 * Index-time write / search / reindex blocks.
 *
 * Classify uses `runTypeSafeDecision` (not a nested block — BP-011).
 * Search lists stored facets and filters in process. No Decisions call.
 */

import { handler, type BlockDefinition, type ResourceCollectionRef } from "@flow-state-dev/core";
import { z } from "zod";
import type { TypeSafeDecisionsClient } from "./client";
import { TypeSafeError } from "./errors";
import {
  FACET_SCHEMA_VERSION,
  INDEXED_DOCS,
  documentKindSchema,
  documentStatusSchema,
  documentTopicSchema,
  documentUrgencySchema,
  indexedDocsResources,
  indexedDocumentFacetsSchema,
  type IndexedDocumentState,
} from "./indexed-docs-resource";
import {
  INDEX_FACET_QUESTIONS,
  facetsFromAnswers,
  filterByFacets,
  hashIndexedContent,
  needsReindex,
  stripIndexedPrefix,
  type FacetQuery,
  type IndexedHit,
} from "./facets";
import { DEFAULT_MIN_CONFIDENCE } from "./route";
import { runTypeSafeDecision } from "./run-decision";

export interface IndexBlockOptions {
  client?: TypeSafeDecisionsClient;
  apiKey?: string;
  collectionKey?: string;
  schemaVersion?: number;
  minConfidence?: number;
}

const ingestInputSchema = z.object({
  key: z.string().min(1),
  title: z.string(),
  body: z.string(),
});

const ingestOutputSchema = z.object({
  key: z.string(),
  facets: indexedDocumentFacetsSchema.nullable(),
  wrote: z.boolean(),
});

const facetQuerySchema = z.object({
  kind: documentKindSchema.optional(),
  topic: documentTopicSchema.optional(),
  status: documentStatusSchema.optional(),
  urgency: documentUrgencySchema.optional(),
});

const searchInputSchema = facetQuerySchema;
const searchHitSchema = z.object({
  key: z.string(),
  title: z.string(),
  facets: indexedDocumentFacetsSchema.nullable(),
});
const searchOutputSchema = z.object({
  matches: z.array(searchHitSchema),
});

const reindexInputSchema = z.object({
  force: z.boolean().optional(),
  schemaVersion: z.number().optional(),
});

const reindexOutputSchema = z.object({
  scanned: z.number(),
  reclassified: z.number(),
  skipped: z.number(),
});

const classifyQueryInputSchema = z.object({
  query: z.string().min(1),
});

const classifyQueryOutputSchema = z.object({
  filter: facetQuerySchema,
  escapeHatch: z.literal(true),
});

export type IngestInput = z.infer<typeof ingestInputSchema>;
export type IngestOutput = z.infer<typeof ingestOutputSchema>;
export type SearchInput = z.infer<typeof searchInputSchema>;
export type SearchOutput = z.infer<typeof searchOutputSchema>;
export type ReindexInput = z.infer<typeof reindexInputSchema>;
export type ReindexOutput = z.infer<typeof reindexOutputSchema>;
export type ClassifyQueryInput = z.infer<typeof classifyQueryInputSchema>;
export type ClassifyQueryOutput = z.infer<typeof classifyQueryOutputSchema>;

function collectionOf(
  ctx: { resources: Record<string, unknown> },
  collectionKey: string,
): ResourceCollectionRef<IndexedDocumentState> {
  const collection = ctx.resources[collectionKey] as
    | ResourceCollectionRef<IndexedDocumentState>
    | undefined;
  if (collection === undefined) {
    throw new TypeSafeError(
      "invalid_state",
      `System One index collection "${collectionKey}" is not installed. ` +
        "Attach createSystemOneIndexCapability() — there is no silent RAG stub.",
    );
  }
  return collection;
}

function asHit(
  path: string,
  state: IndexedDocumentState,
  collectionKey: string,
): IndexedHit {
  return {
    key: stripIndexedPrefix(path, collectionKey),
    title: state.title,
    facets: state.facets,
  };
}

/**
 * Write (or update) a document and classify it into resource-state facets.
 * Skips the model when the content hash and schema version still match.
 */
export function classifyOnWrite(options: IndexBlockOptions = {}) {
  const collectionKey = options.collectionKey ?? INDEXED_DOCS;
  const schemaVersion = options.schemaVersion ?? FACET_SCHEMA_VERSION;
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;

  return handler({
    name: "classifyOnWrite",
    description: "Write a document and classify facets onto its resource state.",
    inputSchema: ingestInputSchema,
    outputSchema: ingestOutputSchema,
    resources: indexedDocsResources,
    execute: async (input, ctx): Promise<IngestOutput> => {
      const collection = collectionOf(ctx, collectionKey);
      const contentHash = hashIndexedContent(input.title, input.body);
      const existing = await collection.getOptional(input.key);
      if (existing !== undefined && !needsReindex(existing.state, contentHash, schemaVersion)) {
        return { key: input.key, facets: existing.state.facets, wrote: false };
      }

      const decision = await runTypeSafeDecision({
        state: { title: input.title, body: input.body },
        questions: INDEX_FACET_QUESTIONS,
        apiKey: options.apiKey,
        client: options.client,
      });
      const facets = facetsFromAnswers(decision.answers, contentHash, {
        schemaVersion,
        minConfidence,
      });

      if (existing !== undefined) {
        await existing.setState({ title: input.title, body: input.body, facets });
      } else {
        await collection.create(input.key, { title: input.title, body: input.body, facets });
      }
      return { key: input.key, facets, wrote: true };
    },
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
    execute: async (input, ctx): Promise<SearchOutput> => {
      const collection = collectionOf(ctx, collectionKey);
      const rows = await collection.list();
      const hits = rows.map((ref) => asHit(ref.path, ref.state, collectionKey));
      return { matches: filterByFacets(hits, input as FacetQuery) };
    },
  });
}

/**
 * Walk the collection and reclassify rows whose content hash or schema
 * version is stale. `force` reclassifies everything.
 */
export function reindexIndexedDocuments(options: IndexBlockOptions = {}) {
  const collectionKey = options.collectionKey ?? INDEXED_DOCS;
  const defaultSchemaVersion = options.schemaVersion ?? FACET_SCHEMA_VERSION;
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;

  return handler({
    name: "reindexIndexedDocuments",
    description: "Reclassify indexed documents whose content or facet schema changed.",
    inputSchema: reindexInputSchema,
    outputSchema: reindexOutputSchema,
    resources: indexedDocsResources,
    execute: async (input, ctx): Promise<ReindexOutput> => {
      const collection = collectionOf(ctx, collectionKey);
      const schemaVersion = input.schemaVersion ?? defaultSchemaVersion;
      const rows = await collection.list();
      let reclassified = 0;
      let skipped = 0;

      for (const ref of rows) {
        const contentHash = hashIndexedContent(ref.state.title, ref.state.body);
        if (!input.force && !needsReindex(ref.state, contentHash, schemaVersion)) {
          skipped += 1;
          continue;
        }
        const decision = await runTypeSafeDecision({
          state: { title: ref.state.title, body: ref.state.body },
          questions: INDEX_FACET_QUESTIONS,
          apiKey: options.apiKey,
          client: options.client,
        });
        const facets = facetsFromAnswers(decision.answers, contentHash, {
          schemaVersion,
          minConfidence,
        });
        await ref.setState({ title: ref.state.title, body: ref.state.body, facets });
        reclassified += 1;
      }

      return { scanned: rows.length, reclassified, skipped };
    },
  });
}

/**
 * Query-time classify. Escape hatch only — search does not use this.
 * Returns a facet filter the host can pass to `searchIndexedDocuments`.
 */
export function classifyQuery(options: IndexBlockOptions = {}) {
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;

  return handler({
    name: "classifyQuery",
    description:
      "Escape hatch: classify a search string into a facet filter. Not the happy path.",
    inputSchema: classifyQueryInputSchema,
    outputSchema: classifyQueryOutputSchema,
    execute: async (input): Promise<ClassifyQueryOutput> => {
      const decision = await runTypeSafeDecision({
        state: input.query,
        questions: INDEX_FACET_QUESTIONS,
        apiKey: options.apiKey,
        client: options.client,
      });
      const facets = facetsFromAnswers(decision.answers, hashIndexedContent(input.query, ""), {
        minConfidence,
      });
      const filter: FacetQuery = {};
      if (facets.kind != null) filter.kind = facets.kind;
      if (facets.topic != null) filter.topic = facets.topic;
      if (facets.status != null) filter.status = facets.status;
      if (facets.urgency != null) filter.urgency = facets.urgency;
      return { filter, escapeHatch: true };
    },
  });
}

/** Tool name generators see when the System One index capability is on. */
export const SEARCH_INDEXED_DOCUMENTS_TOOL = "searchIndexedDocuments";

/**
 * The generator tool the capability installs. Same handler as the
 * search action — still no model in the filter.
 */
export function createSearchIndexedDocumentsTool(
  options: IndexBlockOptions = {},
): BlockDefinition<typeof searchInputSchema, typeof searchOutputSchema> {
  return searchIndexedDocuments(options);
}
