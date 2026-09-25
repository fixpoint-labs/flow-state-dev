/**
 * Goal check — memory captures on a real model with no evaluator installed
 * (FIX-1555; the evaluator epic's leg (f)).
 *
 * Real model, real path, out of CI. See goal.md for the contract. The check
 * itself lives in `check.mts` so the epic's assembled goal can call it.
 *
 * Run: pnpm tsx goals/memory-evaluator-seam/captures-without-an-evaluator/run.mts
 * Control: GOAL_CONTROL=throwing-evaluator (must FAIL on f1 and f2)
 */
import { DEFAULT_MODEL, fail, loadFixture, runGoal, stripIntentOverrides } from "../../lib/index.mts";
import { checkCapturesWithoutAnEvaluator } from "./check.mts";

const fx = loadFixture<{ turn: string }>(import.meta.url);
// The default resolver declares no intents; ambient intent pins would make it throw.
stripIntentOverrides();
const CONTROL = process.env.GOAL_CONTROL;
if (CONTROL !== undefined && CONTROL !== "throwing-evaluator") {
  fail(`unknown GOAL_CONTROL "${CONTROL}" (known: throwing-evaluator)`);
}
if (!process.env.AI_GATEWAY_API_KEY && !process.env.OPENAI_API_KEY) {
  fail("neither AI_GATEWAY_API_KEY nor OPENAI_API_KEY is set: the observer needs a real model");
}

await runGoal(() =>
  checkCapturesWithoutAnEvaluator({
    turn: fx.turn,
    model: DEFAULT_MODEL,
    ...(CONTROL === "throwing-evaluator" ? { control: CONTROL } : {}),
  }),
);
