/**
 * Index-time operations. Shared by capability `fns` (`ctx.cap`) and the
 * handler / tool wrappers. Search never calls the evaluator.
 */

import type { ResourceCollectionRef } from "@flow-state-dev/core";
import { z } from "zod";
import type { EvaluateClient } from "./client";
import { TypeSafeError } from "./errors";
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
import {
  FACET_SCHEMA_VERSION,
  INDEXED_DOCS,
  documentKindSchema,
  documentStatusSchema,
  documentTopicSchema,
  documentUrgencySchema,
  indexedDocumentFacetsSchema,
  type IndexedDocumentState,
} from "./indexed-docs-resource";
import { DEFAULT_MIN_CONFIDENCE } from "./route";
import { runEvaluate } from "./run-evaluate";

export interface IndexOpOptions {
  client?: EvaluateClient;
  apiKey?: string;
  model?: unknown;
  fallbackModel?: string;
  mode?: "evaluate" | "system-2";
  collectionKey?: string;
  schemaVersion?: number;
  minConfidence?: number;
}

export const ingestInputSchema = z.object({
  key: z.string().min(1),
  title: z.string(),
  body: z.string(),
});

export const ingestOutputSchema = z.object({
  key: z.string(),
  facets: indexedDocumentFacetsSchema.nullable(),
  wrote: z.boolean(),
});

export const facetQuerySchema = z.object({
  kind: documentKindSchema.optional(),
  topic: documentTopicSchema.optional(),
  status: documentStatusSchema.optional(),
  urgency: documentUrgencySchema.optional(),
});

export const searchInputSchema = facetQuerySchema;
export const searchHitSchema = z.object({
  key: z.string(),
  title: z.string(),
  facets: indexedDocumentFacetsSchema.nullable(),
});
export const searchOutputSchema = z.object({
  matches: z.array(searchHitSchema),
});

export const reindexInputSchema = z.object({
  force: z.boolean().optional(),
  schemaVersion: z.number().optional(),
});

export const reindexOutputSchema = z.object({
  scanned: z.number(),
  reclassified: z.number(),
  skipped: z.number(),
});

export const classifyQueryInputSchema = z.object({
  query: z.string().min(1),
});

export const classifyQueryOutputSchema = z.object({
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

export function collectionOf(
  ctx: { resources: Record<string, unknown> },
  collectionKey: string,
): ResourceCollectionRef<IndexedDocumentState> {
  const collection = ctx.resources[collectionKey] as
    | ResourceCollectionRef<IndexedDocumentState>
    | undefined;
  if (collection === undefined) {
    throw new TypeSafeError(
      "invalid_state",
      `Index collection "${collectionKey}" is not installed. ` +
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

/** Write or update a document and classify facets onto its resource state. */
export async function ingestIndexedDocument(
  collection: ResourceCollectionRef<IndexedDocumentState>,
  input: IngestInput,
  options: IndexOpOptions = {},
): Promise<IngestOutput> {
  const schemaVersion = options.schemaVersion ?? FACET_SCHEMA_VERSION;
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const contentHash = hashIndexedContent(input.title, input.body);
  const existing = await collection.getOptional(input.key);
  if (existing !== undefined && !needsReindex(existing.state, contentHash, schemaVersion)) {
    return { key: input.key, facets: existing.state.facets, wrote: false };
  }

  const decision = await runEvaluate({
    state: { title: input.title, body: input.body },
    questions: INDEX_FACET_QUESTIONS,
    apiKey: options.apiKey,
    client: options.client,
    model: options.model,
    fallbackModel: options.fallbackModel,
    mode: options.mode,
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
}

/** Deterministic facet filter. No Decisions call. */
export async function searchIndexedCollection(
  collection: ResourceCollectionRef<IndexedDocumentState>,
  query: FacetQuery,
  collectionKey: string = INDEXED_DOCS,
): Promise<SearchOutput> {
  const rows = await collection.list();
  const hits = rows.map((ref) => asHit(ref.path, ref.state, collectionKey));
  return { matches: filterByFacets(hits, query) };
}

/** Reclassify rows whose content hash or facet schema is stale. */
export async function reindexIndexedCollection(
  collection: ResourceCollectionRef<IndexedDocumentState>,
  input: ReindexInput,
  options: IndexOpOptions = {},
): Promise<ReindexOutput> {
  const schemaVersion = input.schemaVersion ?? options.schemaVersion ?? FACET_SCHEMA_VERSION;
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const rows = await collection.list();
  let reclassified = 0;
  let skipped = 0;

  for (const ref of rows) {
    const contentHash = hashIndexedContent(ref.state.title, ref.state.body);
    if (!input.force && !needsReindex(ref.state, contentHash, schemaVersion)) {
      skipped += 1;
      continue;
    }
    const decision = await runEvaluate({
      state: { title: ref.state.title, body: ref.state.body },
      questions: INDEX_FACET_QUESTIONS,
      apiKey: options.apiKey,
      client: options.client,
      model: options.model,
      fallbackModel: options.fallbackModel,
      mode: options.mode,
    });
    const facets = facetsFromAnswers(decision.answers, contentHash, {
      schemaVersion,
      minConfidence,
    });
    await ref.setState({ title: ref.state.title, body: ref.state.body, facets });
    reclassified += 1;
  }

  return { scanned: rows.length, reclassified, skipped };
}

/** Query-time classify. Escape hatch — search does not use this. */
export async function classifyQueryEscape(
  query: string,
  options: IndexOpOptions = {},
): Promise<ClassifyQueryOutput> {
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const decision = await runEvaluate({
    state: query,
    questions: INDEX_FACET_QUESTIONS,
    apiKey: options.apiKey,
    client: options.client,
    model: options.model,
    fallbackModel: options.fallbackModel,
    mode: options.mode,
  });
  const facets = facetsFromAnswers(decision.answers, hashIndexedContent(query, ""), {
    minConfidence,
  });
  const filter: FacetQuery = {};
  if (facets.kind != null) filter.kind = facets.kind;
  if (facets.topic != null) filter.topic = facets.topic;
  if (facets.status != null) filter.status = facets.status;
  if (facets.urgency != null) filter.urgency = facets.urgency;
  return { filter, escapeHatch: true };
}
