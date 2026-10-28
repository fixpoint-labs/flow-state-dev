/**
 * DevTeam's judge: Jev reads a coding run that passed its phase's own check
 * against the task's goal, before the task closes (harness-manager's `judge`
 * slot).
 *
 * Jev answers two choice questions the lab wrote: the verdict (done, not
 * done, or ask the user), with how sure it is, and why an answer isn't
 * done. Only the verdict's confidence is read against the floor. A *not done*
 * verdict's `reason` is the description of the why Jev picked: Jev gives no
 * reason of its own, and the description is what it chose. An *ask* turns
 * into a question to the user that names the goal and quotes the start of
 * the answer, since a user can only judge what they can see.
 *
 * The model is a string the flow's model resolver resolves through its
 * evaluation hook, `typesafe-ai/jev` through the AI Gateway, exactly as best
 * fit runs it. A check scripts it through the same resolver.
 */
import { choice, evaluator, handler, sequencer } from "@flow-state-dev/core";
import {
  harnessJudgeInputSchema,
  harnessJudgeVerdictSchema,
  type HarnessJudge,
  type HarnessJudgeInput,
  type HarnessJudgeVerdict,
} from "@flow-state-dev/harness-manager";
import { z } from "zod";

/** The model the judge runs on: the one best fit runs on. */
export const JUDGE_MODEL = "typesafe-ai/jev";

/**
 * The confidence a *not done* or *ask* must reach to count: the floor the
 * Shift Coordinator's best fit reads (`minConfidence: 0.7` in its `WORKER.md`).
 */
export const JUDGE_FLOOR = 0.7;

/** The evaluator's block name, its verdict question's id, and the id of the question that says why. */
export const JUDGE_BLOCK = "devteam-coder-judge";
export const JUDGE_QUESTION = "verdict";
export const JUDGE_WHY_QUESTION = "why";

/**
 * The verdict, as Jev is offered it: three outcomes that don't overlap, so
 * its confidence in the one it picks isn't split between near-synonyms.
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

/** How much of the answer a question to the user quotes. */
const QUOTED_ANSWER_CHARS = 500;

/**
 * The verdict for Jev's pick: its outcome, its confidence (none reported reads
 * as 0, under any floor), and why. A *not done* gives the reason Jev picked,
 * or the outcome itself when it picked none.
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

/**
 * Build the judge both coder managers run.
 *
 * @param model The evaluation model: {@link JUDGE_MODEL} unless a check passes another.
 * @returns The judge slot's value: the block, and {@link JUDGE_FLOOR}.
 */
export function defineCoderJudge(model: string = JUDGE_MODEL): HarnessJudge {
  const read = evaluator({
    name: JUDGE_BLOCK,
    model,
    inputSchema: harnessJudgeInputSchema,
    state: (input: HarnessJudgeInput) => ({ goal: input.goal, answer: input.answer, commits: input.commits }),
    questions: () => ({
      [JUDGE_QUESTION]: choice(
        "A coding agent was given the goal and ended with the answer, having made the commits listed. " +
          "Did it do what the goal asks?",
        OUTCOMES,
      ),
      [JUDGE_WHY_QUESTION]: choice("If the answer does not do what the goal asks, which of these says why?", WHY),
    }),
  });

  // Jev's answers, read beside the run the judge was handed (this sequencer's
  // own input), since an ask quotes it.
  const decide = handler({
    name: `${JUDGE_BLOCK}-verdict`,
    inputSchema: z.object({ answers: z.record(z.unknown()) }),
    outputSchema: harnessJudgeVerdictSchema,
    execute: async ({ answers }, ctx) => {
      const input = harnessJudgeInputSchema.parse(ctx.sequencer?.input);
      const answer = answers[JUDGE_QUESTION] as { choice?: string; confidence?: number } | undefined;
      if (typeof answer?.choice !== "string") throw new Error("the judge answered no outcome");
      const why = (answers[JUDGE_WHY_QUESTION] as { choice?: string } | undefined)?.choice;
      return verdictOf(input, answer.choice, answer.confidence, why);
    },
  });

  // Stateful, so its steps' `ctx.sequencer` is this sequencer and its input
  // the run as the judge was handed it, not the manager's.
  const block = sequencer({
    name: `${JUDGE_BLOCK}-run`,
    inputSchema: harnessJudgeInputSchema,
    outputSchema: harnessJudgeVerdictSchema,
    stateSchema: z.object({}),
  })
    .step(read)
    .step(decide);

  return { block: block as never, floor: JUDGE_FLOOR };
}
