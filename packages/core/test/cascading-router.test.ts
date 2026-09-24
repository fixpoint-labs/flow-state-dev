/**
 * `utility.cascadingRouter` in isolation: the gate every edge goes through,
 * and the trees it refuses to build.
 *
 * The gate is where "fail closed" lives. A routing tree that treats a missing
 * confidence as a pass sends every case from a model that reports none down
 * whichever branch the model named, with no one the wiser. The table below is
 * the contract; the planted gate at the end proves the table can see that
 * mistake.
 *
 * Walking a tree, failures, trace and resume run in the engine
 * (`packages/engine/test/cascading-router.test.ts`), where `ctx.parent`
 * is real.
 */
import { describe, expect, it } from "vitest";
import { boolean, choice, evaluator } from "../src/blocks/evaluator";
import { handler } from "../src/blocks/handler";
import type { EvaluationModel, EvaluatorAnswer } from "../src/types/evaluation";
import { cascadeGate, type CascadeGateDecision } from "../src/utility/cascading-router-gate";
import { cascadingRouter, type CascadeLevel } from "../src/utility/cascading-router";

type Branches = Record<string, { minConfidence?: number }>;
type Row = {
  rule: string;
  answer: EvaluatorAnswer | undefined;
  branches: Branches;
  expected: CascadeGateDecision;
};

const routes: Branches = { billing: {}, technical: { minConfidence: 0.6 } };

const rows: Row[] = [
  {
    rule: "BR-1: a matching choice with confidence opens a no-floor edge, however low",
    answer: { type: "choice", choice: "billing", confidence: 0.2 },
    branches: routes,
    expected: { edge: "billing", confidence: 0.2 },
  },
  {
    rule: "BR-2: confidence exactly at the floor opens the edge",
    answer: { type: "choice", choice: "technical", confidence: 0.6 },
    branches: routes,
    expected: { edge: "technical", confidence: 0.6 },
  },
  {
    rule: "BR-2: confidence above the floor opens the edge",
    answer: { type: "choice", choice: "technical", confidence: 0.9 },
    branches: routes,
    expected: { edge: "technical", confidence: 0.9 },
  },
  {
    rule: "BR-3: confidence below the floor is ambiguous",
    answer: { type: "choice", choice: "technical", confidence: 0.59 },
    branches: routes,
    expected: { ambiguous: "below-floor" },
  },
  {
    rule: "BR-4: no confidence on a no-floor edge is ambiguous, never the named branch",
    answer: { type: "choice", choice: "billing" },
    branches: routes,
    expected: { ambiguous: "no-confidence" },
  },
  {
    rule: "BR-5: no confidence on an edge with a floor is ambiguous",
    answer: { type: "choice", choice: "technical" },
    branches: routes,
    expected: { ambiguous: "no-confidence" },
  },
  {
    rule: "BR-6: Jev left confidence out for this question (the key is absent)",
    answer: { type: "choice", choice: "billing", probabilities: { billing: 0.8, technical: 0.2 } },
    branches: routes,
    expected: { ambiguous: "no-confidence" },
  },
  {
    rule: "BR-7: NaN is not a confidence",
    answer: { type: "choice", choice: "billing", confidence: Number.NaN },
    branches: routes,
    expected: { ambiguous: "no-confidence" },
  },
  {
    rule: "BR-7: a confidence above 1 is not a confidence",
    answer: { type: "choice", choice: "billing", confidence: 1.5 },
    branches: routes,
    expected: { ambiguous: "no-confidence" },
  },
  {
    rule: "BR-7: a negative confidence is not a confidence",
    answer: { type: "choice", choice: "billing", confidence: -0.1 },
    branches: routes,
    expected: { ambiguous: "no-confidence" },
  },
  {
    rule: "BR-7: a string is not a confidence",
    answer: { type: "choice", choice: "billing", confidence: "0.9" as unknown as number },
    branches: routes,
    expected: { ambiguous: "no-confidence" },
  },
  {
    rule: "BR-8: an option with no branch is ambiguous, never a sibling",
    answer: { type: "choice", choice: "sales", confidence: 0.99 },
    branches: routes,
    expected: { ambiguous: "no-branch" },
  },
  {
    rule: "BR-8: an inherited Object.prototype key is not a branch",
    answer: { type: "choice", choice: "toString", confidence: 0.99 },
    branches: routes,
    expected: { ambiguous: "no-branch" },
  },
  {
    rule: "BR-8: no answer to the routed question is ambiguous",
    answer: undefined,
    branches: routes,
    expected: { ambiguous: "no-branch" },
  },
  {
    rule: "BR-9: a high chosen-option probability does not stand in for confidence",
    answer: { type: "choice", choice: "technical", probabilities: { billing: 0.01, technical: 0.99 } },
    branches: routes,
    expected: { ambiguous: "no-confidence" },
  },
  {
    rule: "BR-9: a boolean's probability is never read as a route",
    answer: { type: "boolean", probability: 0.99 } as EvaluatorAnswer,
    branches: routes,
    expected: { ambiguous: "no-branch" },
  },
];

describe("cascadeGate", () => {
  it.each(rows)("$rule", ({ answer, branches, expected }) => {
    expect(cascadeGate(answer, branches)).toEqual(expected);
  });

  it("control: a gate that treats a missing confidence as 1 fails BR-4, BR-5 and BR-6", () => {
    const planted = (answer: EvaluatorAnswer | undefined, branches: Branches) =>
      cascadeGate(
        answer?.type === "choice" && answer.confidence === undefined ? { ...answer, confidence: 1 } : answer,
        branches
      );
    const failing = rows
      .filter((row) => JSON.stringify(planted(row.answer, row.branches)) !== JSON.stringify(row.expected))
      .map((row) => row.rule.slice(0, 4));
    expect(new Set(failing)).toEqual(new Set(["BR-4", "BR-5", "BR-6", "BR-9"]));
  });
});

// ---------------------------------------------------------------------------
// Building the tree (BR-18 to BR-24)
// ---------------------------------------------------------------------------

const model = {
  specificationVersion: "v4",
  provider: "mock.evaluation",
  modelId: "mock",
  supportedQuestionTypes: ["choice", "score", "boolean"],
  async doEvaluate() {
    throw new Error("never called at build");
  },
} as unknown as EvaluationModel;

const department = evaluator({
  name: "department",
  model,
  questions: {
    team: choice("Which team?", { billing: "Payments", technical: "Bugs" }),
    urgent: boolean("Urgent?"),
  },
});
const leaf = handler({ name: "leaf", execute: () => ({ ok: true }) });
const review = handler({ name: "review", execute: () => ({ review: true }) });

/** Build with a root the types would refuse, to reach the runtime checks. */
function build(root: unknown, ambiguous: unknown = review) {
  return () =>
    cascadingRouter({ name: "triage", ambiguous: ambiguous as never, root: root as CascadeLevel as never });
}

describe("cascadingRouter · build", () => {
  it("builds a valid tree, and a leaf under two edges (BR-14)", () => {
    expect(
      build({ ask: department, on: "team", branches: { billing: { block: leaf }, technical: { block: leaf } } })
    ).not.toThrow();
  });

  it("BR-18: a branch with both block and next is refused, naming the cascade and the branch", () => {
    const next = { ask: department, on: "team", branches: { billing: { block: leaf } } };
    expect(build({ ask: department, on: "team", branches: { billing: { block: leaf, next } } })).toThrow(
      /cascadingRouter "triage".*"root\/billing".*exactly one of block or next/
    );
  });

  it("BR-18: a branch with neither is refused", () => {
    expect(build({ ask: department, on: "team", branches: { billing: { minConfidence: 0.5 } } })).toThrow(
      /"root\/billing" needs exactly one of block or next/
    );
  });

  it("BR-19: routing on a question the evaluator doesn't ask is refused", () => {
    expect(build({ ask: department, on: "dept", branches: { billing: { block: leaf } } })).toThrow(
      /routes on "dept", which evaluator "department" doesn't ask/
    );
  });

  it("BR-19: routing on a question that isn't a choice is refused", () => {
    expect(build({ ask: department, on: "urgent", branches: { billing: { block: leaf } } })).toThrow(
      /"urgent", which is a boolean question, not a choice/
    );
  });

  it("BR-20: a branch key that isn't an option is refused", () => {
    expect(build({ ask: department, on: "team", branches: { sales: { block: leaf } } })).toThrow(
      /branch "root\/sales": "sales" is not an option of "team"/
    );
  });

  it("BR-21: an evaluator whose questions are a function of input builds; option checks are type-level only", () => {
    const dynamic = evaluator({
      name: "dynamic",
      model,
      questions: () => ({ tier: choice("Tier?", { gold: "g", silver: "s" }) }),
    });
    expect(build({ ask: dynamic, on: "tier", branches: { bronze: { block: leaf } } })).not.toThrow();
  });

  it.each([-0.1, 1.01, Number.NaN, "0.5"])("BR-22: minConfidence %s is refused", (floor) => {
    expect(
      build({ ask: department, on: "team", branches: { billing: { minConfidence: floor, block: leaf } } })
    ).toThrow(/"root\/billing": minConfidence must be between 0 and 1/);
  });

  it("BR-22: minConfidence 0 and 1 build", () => {
    expect(
      build({
        ask: department,
        on: "team",
        branches: { billing: { minConfidence: 0, block: leaf }, technical: { minConfidence: 1, block: leaf } },
      })
    ).not.toThrow();
  });

  it("BR-23: a missing ambiguous is refused", () => {
    const root = { ask: department, on: "team", branches: { billing: { block: leaf } } };
    expect(() => cascadingRouter({ name: "triage", root } as never)).toThrow(
      /cascadingRouter "triage": ambiguous is required/
    );
  });

  it("BR-24: a tree that reaches a level it is already inside is refused", () => {
    const inner: { ask: unknown; on: string; branches: Record<string, unknown> } = {
      ask: department,
      on: "team",
      branches: { technical: { block: leaf } },
    };
    const root = { ask: department, on: "team", branches: { billing: { next: inner } } };
    inner.branches.billing = { next: root };
    expect(build(root)).toThrow(/"root\/billing\/billing" is already inside itself/);
  });

  it("a level must ask an evaluator block", () => {
    expect(build({ ask: leaf, on: "team", branches: { billing: { block: leaf } } })).toThrow(
      /the level at "root" must ask an evaluator block/
    );
  });
});
