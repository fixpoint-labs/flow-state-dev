/**
 * The questions a ticket is classified by, the stored shape of their answers,
 * and the deterministic match a facet search runs.
 *
 * The questions belong to the app. The answers are stored exactly as the
 * evaluator returned them (FSD's `EvaluatorAnswers` type): a choice, plus
 * `probabilities` and `confidence` only when the model reported them. Nothing
 * is added or dropped at write; certainty is asked for at search.
 */
import {
  choice,
  type EvaluatorAnswers,
  type EvaluatorDefinition,
} from "@flow-state-dev/core";
import { z } from "zod";

const TOPICS = {
  billing: "Payments, charges, refunds and invoices",
  outage: "Something is down, broken or erroring",
  other: "Anything else",
} as const;

const STATUSES = {
  open: "The customer still needs something from us",
  closed: "The problem is resolved or needs nothing further",
} as const;

/** The fixed questions every ticket body is asked once, when it is written. */
export const ticketQuestions = {
  topic: choice("What is this support ticket about?", TOPICS),
  status: choice("Is the customer's problem still open?", STATUSES),
};

export type TicketQuestions = typeof ticketQuestions;
export type TicketTopic = keyof typeof TOPICS;
export type TicketStatus = keyof typeof STATUSES;

/** Stored facets: the evaluator's answers, keyed by question id. */
export type TicketFacets = EvaluatorAnswers<TicketQuestions>;

/**
 * The evaluator block the flow takes. The app builds it where it names its
 * model; its input is the ticket body.
 */
export type TicketEvaluator = EvaluatorDefinition<z.ZodTypeAny, string, TicketQuestions>;

const topicKeys = Object.keys(TOPICS) as [TicketTopic, ...TicketTopic[]];
const statusKeys = Object.keys(STATUSES) as [TicketStatus, ...TicketStatus[]];

function choiceAnswerSchema<T extends string>(keys: [T, ...T[]]) {
  return z.object({
    type: z.literal("choice"),
    choice: z.enum(keys),
    probabilities: z.record(z.string(), z.number()).optional(),
    confidence: z.number().optional(),
  });
}

/** Zod schema for {@link TicketFacets}, used in the collection's state. */
export const ticketFacetsSchema = z.object({
  topic: choiceAnswerSchema(topicKeys),
  status: choiceAnswerSchema(statusKeys),
}) as unknown as z.ZodType<TicketFacets>;

/** What a facet search asks: facet values, and optionally a minimum confidence. */
export const facetQuerySchema = z.object({
  topic: z.enum(topicKeys).optional().describe("Only tickets about this topic"),
  status: z.enum(statusKeys).optional().describe("Only tickets with this status"),
  minConfidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Only answers the model reported at least this confidence for"),
});

export type FacetQuery = z.infer<typeof facetQuerySchema>;

/**
 * True when stored facets satisfy every value the query names. A ticket with
 * no facets (never classified, failed, or cleared) never matches. A minimum
 * confidence applies to the answers the query names; an answer that carries
 * no confidence fails it.
 */
export function matchesFacets(facets: TicketFacets | null, query: FacetQuery): boolean {
  if (facets === null) return false;
  const wanted: Array<[keyof TicketFacets, string | undefined]> = [
    ["topic", query.topic],
    ["status", query.status],
  ];
  for (const [id, value] of wanted) {
    if (value === undefined) continue;
    const answer = facets[id];
    if (answer.choice !== value) return false;
    if (query.minConfidence !== undefined) {
      if (answer.confidence === undefined || answer.confidence < query.minConfidence) return false;
    }
  }
  return true;
}
