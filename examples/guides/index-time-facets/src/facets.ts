/**
 * The questions a ticket is classified by, and the types that follow from
 * them.
 *
 * The questions belong to the app. `defineFacetedCollection` reads them off
 * the evaluator: the stored facets are the evaluator's answers, exactly as
 * returned (a choice, plus `probabilities` and `confidence` only when the
 * model reported them), and a search takes one optional value per choice
 * question.
 */
import {
  choice,
  type EvaluatorAnswers,
  type EvaluatorDefinition,
  type FacetedState,
  type FacetSearchInput,
} from "@flow-state-dev/core";
import type { z } from "zod";

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

/** Stored facets: the evaluator's answers, keyed by question id. */
export type TicketFacets = EvaluatorAnswers<TicketQuestions>;

/** A ticket's stored state: its title, plus the facets and token the collection adds. */
export type TicketState = FacetedState<{ title: string }, TicketFacets>;

/** What a facet search asks: facet values, and optionally a minimum confidence. */
export type FacetQuery = FacetSearchInput<TicketFacets>;

/**
 * The evaluator block the flow takes. The app builds it where it names its
 * model; its input is the ticket body.
 */
export type TicketEvaluator = EvaluatorDefinition<z.ZodTypeAny, string, TicketQuestions>;
