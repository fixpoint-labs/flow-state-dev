/**
 * Compile-time assertions for `utility.cascadingRouter`: a level routes only
 * on one of its evaluator's choice questions, a branch key must be one of
 * that question's options (at every depth, and for questions computed from
 * input), and `ambiguous` is required.
 */
import type { BlockDefinition, EvaluationModel } from "@flow-state-dev/core";
import { boolean, choice, evaluator, handler, utility } from "@flow-state-dev/core";
import { z } from "zod";

declare const model: EvaluationModel;
declare const leaf: BlockDefinition;

const department = evaluator({
  name: "department",
  model,
  questions: {
    team: choice("Which team?", { billing: "Payments", technical: "Bugs" }),
    urgent: boolean("Urgent?"),
  },
});
const urgency = evaluator({
  name: "urgency",
  model,
  questions: { urgency: choice("How urgent?", { high: "Now", low: "Later" }) },
});
// Questions computed from input still type the answers.
const dynamic = evaluator({
  name: "dynamic",
  model,
  questions: (_input: unknown) => ({ tier: choice("Tier?", { gold: "g", silver: "s" }) }),
});

// A correct two-level tree compiles.
utility.cascadingRouter({
  name: "ok",
  ambiguous: leaf,
  root: {
    ask: department,
    on: "team",
    branches: {
      billing: {
        minConfidence: 0.6,
        next: { ask: urgency, on: "urgency", branches: { high: { block: leaf }, low: { block: leaf } } },
      },
      technical: { block: leaf },
    },
  },
});

// Routing on a question the evaluator doesn't ask does not compile.
utility.cascadingRouter({
  name: "bad-on",
  ambiguous: leaf,
  // @ts-expect-error "department" is not a question of the evaluator
  root: { ask: department, on: "department", branches: { billing: { block: leaf } } },
});

// Routing on a boolean question does not compile: only choices route.
utility.cascadingRouter({
  name: "bad-kind",
  ambiguous: leaf,
  // @ts-expect-error "urgent" is a boolean question, not a choice
  root: { ask: department, on: "urgent", branches: { billing: { block: leaf } } },
});

// A branch key that isn't one of the choice's options does not compile.
utility.cascadingRouter({
  name: "bad-key",
  ambiguous: leaf,
  // @ts-expect-error "sales" is not an option of "team"
  root: { ask: department, on: "team", branches: { sales: { block: leaf } } },
});

// ...nor at level two.
utility.cascadingRouter({
  name: "bad-nested-key",
  ambiguous: leaf,
  root: {
    ask: department,
    on: "team",
    branches: {
      // @ts-expect-error "urgent" is not an option of "urgency"
      billing: { next: { ask: urgency, on: "urgency", branches: { urgent: { block: leaf } } } },
    },
  },
});

// ...nor on an evaluator whose questions are a function of input.
utility.cascadingRouter({
  name: "bad-dynamic-key",
  ambiguous: leaf,
  // @ts-expect-error "bronze" is not an option of "tier"
  root: { ask: dynamic, on: "tier", branches: { bronze: { block: leaf } } },
});

// `ambiguous` is required.
// @ts-expect-error missing ambiguous
utility.cascadingRouter({
  name: "no-ambiguous",
  root: { ask: department, on: "team", branches: { billing: { block: leaf } } },
});

// ---------------------------------------------------------------------------
// The router's input and output types
// ---------------------------------------------------------------------------

type Ticket = { id: string; message: string };
const ticketSchema = z.object({ id: z.string(), message: z.string() });

const typedDepartment = evaluator({
  name: "typed-department",
  model,
  inputSchema: ticketSchema,
  state: (input) => input.message,
  questions: { team: choice("Which team?", { billing: "Payments", technical: "Bugs" }) },
});
const typedUrgency = evaluator({
  name: "typed-urgency",
  model,
  inputSchema: ticketSchema,
  questions: { urgency: choice("How urgent?", { high: "Now", low: "Later" }) },
});
const escalate = handler({
  name: "escalate",
  inputSchema: ticketSchema,
  execute: (input) => ({ escalated: input.id }),
});
const techQueue = handler({
  name: "tech-queue",
  inputSchema: ticketSchema,
  execute: (input) => ({ queued: input.id }),
});
const typedReview = handler({
  name: "typed-review",
  inputSchema: ticketSchema,
  execute: (input) => ({ review: input.id }),
});
const wantsANumber = handler({
  name: "wants-a-number",
  inputSchema: z.object({ n: z.number() }),
  execute: (input) => ({ n: input.n }),
});
const numberEvaluator = evaluator({
  name: "number-evaluator",
  model,
  inputSchema: z.object({ n: z.number() }),
  questions: { urgency: choice("How urgent?", { high: "Now", low: "Later" }) },
});

const typedTriage = utility.cascadingRouter({
  name: "typed",
  ambiguous: typedReview,
  root: {
    ask: typedDepartment,
    on: "team",
    branches: {
      billing: { next: { ask: typedUrgency, on: "urgency", branches: { high: { block: escalate } } } },
      technical: { block: techQueue },
    },
  },
});

// The router takes the root evaluator's input...
declare function inputOf<I>(block: BlockDefinition<any, any, I, any>): I;
const typedInput: Ticket = inputOf(typedTriage);
void typedInput;
// @ts-expect-error the input is a ticket, not any
const notAny: number = inputOf(typedTriage);
void notAny;
// ...and returns the union of every leaf's and `ambiguous`'s output.
declare function outputOf<O>(block: BlockDefinition<any, any, any, O>): O;
const typedOutput: { escalated: string } | { queued: string } | { review: string } = outputOf(typedTriage);
void typedOutput;
// @ts-expect-error the output is a union, not any one leaf's output
const notJustOne: { escalated: string } = outputOf(typedTriage);
void notJustOne;

// A leaf that can't take the router's input does not compile.
utility.cascadingRouter({
  name: "bad-leaf-input",
  ambiguous: typedReview,
  root: {
    ask: typedDepartment,
    on: "team",
    // @ts-expect-error wantsANumber does not accept a ticket
    branches: { technical: { block: wantsANumber } },
  },
});

// Nor does an `ambiguous` that can't take it.
utility.cascadingRouter({
  name: "bad-ambiguous-input",
  // @ts-expect-error wantsANumber does not accept a ticket
  ambiguous: wantsANumber,
  root: { ask: typedDepartment, on: "team", branches: { technical: { block: techQueue } } },
});

// Nor a level-2 evaluator that can't take it.
utility.cascadingRouter({
  name: "bad-nested-evaluator-input",
  ambiguous: typedReview,
  root: {
    ask: typedDepartment,
    on: "team",
    branches: {
      // @ts-expect-error numberEvaluator does not accept a ticket
      billing: { next: { ask: numberEvaluator, on: "urgency", branches: { high: { block: escalate } } } },
    },
  },
});
