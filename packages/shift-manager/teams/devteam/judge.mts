/**
 * DevTeam's judge: Jev reads a coding run that passed its phase's own check
 * against the task's goal, before the task closes (harness-manager's `judge`
 * slot). It is harness-manager's `goalJudge`, under DevTeam's block name, on
 * the model and floor the chief of staff's best fit runs on.
 *
 * The model is a string the flow's model resolver resolves through its
 * evaluation hook, `typesafe-ai/jev` through the AI Gateway, exactly as best
 * fit runs it. A check scripts it through the same resolver.
 */
import { goalJudge, GOAL_JUDGE_MODEL, GOAL_JUDGE_QUESTION, GOAL_JUDGE_WHY_QUESTION, type HarnessJudge } from "@flow-state-dev/harness-manager";

/** The model the judge runs on: the one best fit runs on. */
export const JUDGE_MODEL = GOAL_JUDGE_MODEL;

/**
 * The confidence a *not done* or *ask* must reach to count: the floor the
 * Shift Coordinator's best fit reads (`minConfidence: 0.7` in its `WORKER.md`).
 */
export const JUDGE_FLOOR = 0.7;

/** The evaluator's block name, its verdict question's id, and the id of the question that says why. */
export const JUDGE_BLOCK = "devteam-coder-judge";
export const JUDGE_QUESTION = GOAL_JUDGE_QUESTION;
export const JUDGE_WHY_QUESTION = GOAL_JUDGE_WHY_QUESTION;

/**
 * Build the judge both coder managers run.
 *
 * @param model The evaluation model: {@link JUDGE_MODEL} unless a check passes another.
 * @returns The judge slot's value: the block, and {@link JUDGE_FLOOR}.
 */
export function defineCoderJudge(model: string = JUDGE_MODEL): HarnessJudge {
  return goalJudge({ name: JUDGE_BLOCK, model, floor: JUDGE_FLOOR });
}
