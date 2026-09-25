/**
 * Compile-time assertions for `defineFacetedCollection`: the search's
 * options are the choice questions' option keys (a boolean or score question
 * has none), and the stored facets are the evaluator's answers type.
 */
import type {
  BlockInput,
  EvaluationModel,
  EvaluatorAnswers,
} from "@flow-state-dev/core";
import { boolean, choice, defineFacetedCollection, evaluator, score } from "@flow-state-dev/core";
import { z } from "zod";

declare const model: EvaluationModel;

const questions = {
  topic: choice("Topic?", { billing: "b", outage: "o" }),
  urgent: boolean("Urgent?"),
  severity: score("How bad?", ["minor", "major"]),
};

const tickets = defineFacetedCollection({
  name: "tickets",
  pattern: "tickets/*",
  scope: "user",
  stateSchema: z.object({ title: z.string() }),
  evaluator: evaluator({ name: "triage", model, questions }),
});

type SearchInput = BlockInput<typeof tickets.search>;

// A choice question's option keys are the values; every option is optional.
const ok: SearchInput = { topic: "billing", minConfidence: 0.8 };
const empty: SearchInput = {};
void ok;
void empty;

// @ts-expect-error "sales" is not an option of "topic"
const badOption: SearchInput = { topic: "sales" };
void badOption;

// @ts-expect-error a boolean question has no search option
const boolOption: SearchInput = { urgent: true };
void boolOption;

// @ts-expect-error a score question has no search option
const scoreOption: SearchInput = { severity: 1 };
void scoreOption;

// The stored facets are the evaluator's answers.
type Stored = typeof tickets.collection.StateType;
const facets: EvaluatorAnswers<typeof questions> | null = null as unknown as Stored["facets"];
const back: Stored["facets"] = null as unknown as EvaluatorAnswers<typeof questions> | null;
const title: string = null as unknown as Stored["title"];
const indexedAs: string | null = null as unknown as Stored["indexedAs"];
void facets;
void back;
void title;
void indexedAs;

// The collection is registered under `name` in the returned resources.
const registered: typeof tickets.collection = tickets.resources.tickets;
void registered;

// The utility owns contentUpdated: binding it doesn't compile.
defineFacetedCollection({
  name: "docs",
  pattern: "docs/*",
  scope: "user",
  stateSchema: z.object({}),
  evaluator: evaluator({ name: "t2", model, questions }),
  // @ts-expect-error contentUpdated is the utility's own reaction
  reactTo: { contentUpdated: tickets.search },
});
