/**
 * A ready-made judge for the manager's `judge` slot: an evaluation model reads
 * a coding run that passed its phase's own check against the task's goal,
 * before the task closes.
 *
 * The model answers two choice questions: the verdict (done, not done, or ask
 * the person), with how sure it is, and why an answer isn't done. Only the
 * verdict's confidence is read against the floor. A *not done* verdict's
 * `reason` is the description of the why the model picked: it gives no reason
 * of its own, and the description is what it chose. An *ask* turns into a
 * question to the person that names the goal and quotes the start of the
 * answer, since a person can only judge what they can see.
 *
 * The model is a string the flow's model resolver resolves through its
 * evaluation hook; a check scripts it through the same resolver.
 */
import { choice, evaluator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import {
  harnessJudgeInputSchema,
  harnessJudgeVerdictSchema,
  type HarnessJudge,
  type HarnessJudgeInput,
  type HarnessJudgeVerdict,
} from "./manager";

/** The evaluation model the judge runs on unless a host names another. */
export const GOAL_JUDGE_MODEL = "typesafe-ai/jev";

/** The confidence a *not done* or *ask* must reach to count unless a host names another. */
export const GOAL_JUDGE_FLOOR = 0.7;

/** The id of the verdict question and of the question that says why, as the model is asked them. */
export const GOAL_JUDGE_QUESTION = "verdict";
export const GOAL_JUDGE_WHY_QUESTION = "why";

/**
 * The verdict, as the model is offered it: three outcomes that don't overlap,
 * so its confidence in the one it picks isn't split between near-synonyms.
 */
const OUTCOMES = {
  done: "The answer does what the goal asks.",
  "not-done": "The answer does not do what the goal asks.",
  ask: "Whether the answer meets the goal depends on something only the user who asked can say.",
} as const;

/** Why an answer isn't done, asked beside the verdict and read only for *not done*: the reason a retry is handed. */
const WHY = {
  "off-target": "The answer does not address what the goal asks.",
  unsupported: "The answer does not show the work the goal needs, such as reading the code it is about.",
  "change-missing": "The goal asks for a change, and the run's commits do not make it.",
} as const;

/** How much of the answer a question to the person quotes. */
const QUOTED_ANSWER_CHARS = 500;

/**
 * The verdict for the model's pick: its outcome, its confidence (none
 * reported reads as 0, under any floor), and why. A *not done* gives the
 * reason picked, or the outcome itself when none was.
 */
function verdictOf(input: HarnessJudgeInput, picked: string, confidence: number | undefined, why: string | undefined): HarnessJudgeVerdict {
  const sure = confidence ?? 0;
  if (picked === "done") return { verdict: "done", confidence: sure, reason: OUTCOMES.done };
  if (picked === "ask") {
    const answer = (input.answer ?? "").trim();
    const quoted = answer.length > QUOTED_ANSWER_CHARS ? `${answer.slice(0, QUOTED_ANSWER_CHARS)}…` : answer;
    return {
      verdict: "ask",
      confidence: sure,
      reason:
        `I can't tell whether this answers "${input.goal}" without you. Does it, or what did you mean? ` +
        `The answer so far: ${quoted === "" ? "(none)" : quoted}`,
    };
  }
  // An outcome that isn't one of the choices is not a verdict: the manager settles on the phase's check.
  if (picked !== "not-done") throw new Error(`the judge picked "${picked}", which is not one of its outcomes`);
  const reason = (WHY as Record<string, string>)[why ?? ""] ?? OUTCOMES["not-done"];
  return { verdict: "not-done", confidence: sure, reason: `The judge read the answer against the goal: ${reason}` };
}

/** What {@link goalJudge} takes. */
export interface GoalJudgeOptions {
  /** The evaluator block's name; its steps are named after it. */
  name: string;
  /** The evaluation model. Default {@link GOAL_JUDGE_MODEL}. */
  model?: string;
  /** The floor a *not done* or *ask* must reach. Default {@link GOAL_JUDGE_FLOOR}. */
  floor?: number;
}

/**
 * Build a judge for the manager's `judge` option.
 *
 * @param options The block's name, and optionally the model and floor.
 * @returns The judge slot's value: the block, and its floor.
 */
export function goalJudge({ name, model = GOAL_JUDGE_MODEL, floor = GOAL_JUDGE_FLOOR }: GoalJudgeOptions): HarnessJudge {
  const read = evaluator({
    name,
    model,
    inputSchema: harnessJudgeInputSchema,
    state: (input: HarnessJudgeInput) => ({ goal: input.goal, answer: input.answer, commits: input.commits }),
    questions: () => ({
      [GOAL_JUDGE_QUESTION]: choice(
        "A coding agent was given the goal and ended with the answer, having made the commits listed. " +
          "Did it do what the goal asks?",
        OUTCOMES,
      ),
      [GOAL_JUDGE_WHY_QUESTION]: choice("If the answer does not do what the goal asks, which of these says why?", WHY),
    }),
  });

  // The model's answers, read beside the run the judge was handed (this
  // sequencer's own input), since an ask quotes it.
  const decide = handler({
    name: `${name}-verdict`,
    inputSchema: z.object({ answers: z.record(z.unknown()) }),
    outputSchema: harnessJudgeVerdictSchema,
    execute: async ({ answers }, ctx) => {
      const input = harnessJudgeInputSchema.parse(ctx.sequencer?.input);
      const answer = answers[GOAL_JUDGE_QUESTION] as { choice?: string; confidence?: number } | undefined;
      if (typeof answer?.choice !== "string") throw new Error("the judge answered no outcome");
      const why = (answers[GOAL_JUDGE_WHY_QUESTION] as { choice?: string } | undefined)?.choice;
      return verdictOf(input, answer.choice, answer.confidence, why);
    },
  });

  // Stateful, so its steps' `ctx.sequencer` is this sequencer and its input
  // the run as the judge was handed it, not the manager's.
  const block = sequencer({
    name: `${name}-run`,
    inputSchema: harnessJudgeInputSchema,
    outputSchema: harnessJudgeVerdictSchema,
    stateSchema: z.object({}),
  })
    .step(read)
    .step(decide);

  return { block: block as never, floor };
}
