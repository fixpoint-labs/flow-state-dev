/**
 * Index-time facet helpers. Classify uses Jev; search never does.
 */

import { createHash } from "node:crypto";
import { TypeSafeError } from "./errors";
import {
  FACET_SCHEMA_VERSION,
  documentKindSchema,
  documentStatusSchema,
  documentTopicSchema,
  documentUrgencySchema,
  type DocumentKind,
  type DocumentStatus,
  type DocumentTopic,
  type DocumentUrgency,
  type IndexedDocumentFacets,
  type IndexedDocumentState,
} from "./indexed-docs-resource";
import { DEFAULT_MIN_CONFIDENCE } from "./route";
import { choice, isChoiceAnswer, type TypeSafeAnswers, type TypeSafeQuestions } from "./schemas";

export const FACET_KIND_QUESTION = "kind";
export const FACET_TOPIC_QUESTION = "topic";
export const FACET_STATUS_QUESTION = "status";
export const FACET_URGENCY_QUESTION = "urgency";

/** Questions Jev answers at write / reindex. Search does not ask these. */
export const INDEX_FACET_QUESTIONS = {
  [FACET_KIND_QUESTION]: choice("What kind of document is this?", {
    ticket: "A support or work ticket that needs handling",
    note: "A short note or standup scratch",
    spec: "A plan, spec, or design for work to do",
    other: "None of the other kinds fit",
  }),
  [FACET_TOPIC_QUESTION]: choice("What is the topic?", {
    billing: "Payments, invoices, charges, refunds",
    launch: "A product or feature launch",
    infra: "Infrastructure, hosting, or internals",
    other: "None of the other topics fit",
  }),
  [FACET_STATUS_QUESTION]: choice("What is the status?", {
    open: "Still in progress or unresolved",
    closed: "Done, resolved, or historical",
    unknown: "Status is not stated",
  }),
  [FACET_URGENCY_QUESTION]: choice("How urgent is this?", {
    low: "No hurry",
    normal: "Ordinary priority",
    high: "Needs attention soon",
  }),
} as const satisfies TypeSafeQuestions;

export type FacetQuery = {
  kind?: DocumentKind;
  topic?: DocumentTopic;
  status?: DocumentStatus;
  urgency?: DocumentUrgency;
};

export type IndexedHit = {
  key: string;
  title: string;
  facets: IndexedDocumentFacets | null;
};

/**
 * Stable hash of the fields that, if they change, stale the stored facets.
 */
export function hashIndexedContent(title: string, body: string): string {
  return createHash("sha256").update(JSON.stringify({ title, body })).digest("hex");
}

/**
 * True when stored facets are missing, the body changed, or the schema moved.
 */
export function needsReindex(
  state: Pick<IndexedDocumentState, "facets">,
  contentHash: string,
  schemaVersion: number = FACET_SCHEMA_VERSION,
): boolean {
  const facets = state.facets;
  if (facets == null) return true;
  if (facets.contentHash !== contentHash) return true;
  if (facets.schemaVersion !== schemaVersion) return true;
  return false;
}

/**
 * Deterministic AND match over stored facets. No model. A specified
 * field fails closed when that facet is null.
 */
export function filterByFacets<T extends { facets: IndexedDocumentFacets | null }>(
  rows: readonly T[],
  query: FacetQuery,
): T[] {
  return rows.filter((row) => {
    const facets = row.facets;
    if (facets == null) return false;
    if (query.kind !== undefined && facets.kind !== query.kind) return false;
    if (query.topic !== undefined && facets.topic !== query.topic) return false;
    if (query.status !== undefined && facets.status !== query.status) return false;
    if (query.urgency !== undefined && facets.urgency !== query.urgency) return false;
    return true;
  });
}

function readChoice<T extends string>(
  answers: TypeSafeAnswers,
  key: string,
  allowed: ReadonlySet<T>,
  minConfidence: number,
): T | null {
  const answer = answers[key];
  if (answer === undefined || !isChoiceAnswer(answer)) {
    throw new TypeSafeError(
      "unexpected_answer",
      `Index classify expected a Choice answer for "${key}".`,
    );
  }
  if (answer.confidence < minConfidence) return null;
  if (!allowed.has(answer.choice as T)) {
    throw new TypeSafeError(
      "unexpected_answer",
      `Index classify returned unknown "${key}" choice "${answer.choice}".`,
    );
  }
  return answer.choice as T;
}

/**
 * Map a Jev answers bag onto stored facets. Low confidence leaves that
 * field null rather than guessing.
 */
export function facetsFromAnswers(
  answers: TypeSafeAnswers,
  contentHash: string,
  options: { schemaVersion?: number; minConfidence?: number; now?: string } = {},
): IndexedDocumentFacets {
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const schemaVersion = options.schemaVersion ?? FACET_SCHEMA_VERSION;
  return {
    kind: readChoice(answers, FACET_KIND_QUESTION, new Set(documentKindSchema.options), minConfidence),
    topic: readChoice(answers, FACET_TOPIC_QUESTION, new Set(documentTopicSchema.options), minConfidence),
    status: readChoice(
      answers,
      FACET_STATUS_QUESTION,
      new Set(documentStatusSchema.options),
      minConfidence,
    ),
    urgency: readChoice(
      answers,
      FACET_URGENCY_QUESTION,
      new Set(documentUrgencySchema.options),
      minConfidence,
    ),
    classifiedAt: options.now ?? new Date().toISOString(),
    contentHash,
    schemaVersion,
  };
}

export function stripIndexedPrefix(path: string, collectionKey: string = "indexed-docs"): string {
  const prefix = `${collectionKey}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}
