/**
 * Compile-time assertions for evaluator answer typing: each answer is typed
 * by its question, a choice answer is the union of the declared option keys,
 * and a wrong option key fails to compile. Static and function question sets
 * type the same way.
 */
import type { BlockOutput, EvaluationModel, EvaluatorAnswers } from "@flow-state-dev/core";
import { boolean, choice, evaluator, score } from "@flow-state-dev/core";

declare const model: EvaluationModel;

const triage = evaluator({
  name: "triage",
  model,
  questions: {
    team: choice("Which team?", { billing: "Payments", technical: "Bugs" }),
    frustration: score("How frustrated?", ["Calm", "Annoyed", "Angry"]),
    urgent: boolean("Urgent?"),
  },
});

type Answers = BlockOutput<typeof triage>["answers"];

const team: "billing" | "technical" = null as unknown as Answers["team"]["choice"];
const frustration: number = null as unknown as Answers["frustration"]["score"];
const urgent: number = null as unknown as Answers["urgent"]["probability"];
const confidence: number | undefined = null as unknown as Answers["team"]["confidence"];
void team;
void frustration;
void urgent;
void confidence;

// A wrong option key does not compile.
// @ts-expect-error "sales" is not a declared option
const wrong: Answers["team"]["choice"] = "sales";
void wrong;

// A boolean answer has no `choice`.
// @ts-expect-error boolean answers carry `probability`, not `choice`
type _NoChoice = Answers["urgent"]["choice"];

// A questions function types its answers from its return type.
const activator = evaluator({
  name: "activator",
  model: "typesafe-ai/jev",
  questions: (_input: string) => ({
    skill: choice("Which skill?", { search: null, write: null }),
  }),
});
const skill: "search" | "write" = null as unknown as BlockOutput<typeof activator>["answers"]["skill"]["choice"];
void skill;

// The exported answer map type agrees with the block output.
type _Same = EvaluatorAnswers<{ urgent: ReturnType<typeof boolean> }>["urgent"]["probability"];
const _p: _Same = 0.5;
void _p;
