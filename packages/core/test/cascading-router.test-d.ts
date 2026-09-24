/**
 * Compile-time assertions for `utility.cascadingRouter`: a level routes only
 * on one of its evaluator's choice questions, a branch key must be one of
 * that question's options (at every depth, and for questions computed from
 * input), and `ambiguous` is required.
 */
import type { BlockDefinition, EvaluationModel } from "@flow-state-dev/core";
import { boolean, choice, evaluator, utility } from "@flow-state-dev/core";

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
