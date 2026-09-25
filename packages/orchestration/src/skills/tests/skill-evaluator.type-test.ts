/**
 * Type-level tests for `createSkillActivator`'s `evaluator` slot.
 *
 * Under `src/` on purpose: this package's typecheck includes `src/**` only,
 * and vitest does not check types, so a `@ts-expect-error` in `test/` would be
 * inert (same convention as `tasks/collection/tests/task-caps.type-test.ts`).
 *
 * What they pin down: both documented ways to fill the slot compile (the
 * helper, with or without `recentMessages`, and a block hand-built from
 * `skillQuestions`), and a block of another kind does not.
 */
import { evaluator, handler } from "@flow-state-dev/core";
import { createSkillActivator } from "../skill-activator";
import { skillEvaluator, skillQuestions } from "../skill-evaluator";

// The helper, with a model string.
createSkillActivator({ evaluator: skillEvaluator("provider/model") });

// The helper, with the earlier turns a follow-up needs.
createSkillActivator({ evaluator: skillEvaluator("provider/model", { recentMessages: 3 }) });

// @ts-expect-error — the count is a number.
skillEvaluator("provider/model", { recentMessages: "3" });

// A block hand-built from the question function, as the docs show it.
const pickSkill = evaluator({
  name: "pick-skill",
  model: "provider/model",
  state: (input) => input.message,
  questions: skillQuestions,
});
createSkillActivator({ evaluator: pickSkill });

// A handler is not an evaluator.
// @ts-expect-error — the slot is typed on core's evaluator block.
createSkillActivator({ evaluator: handler({ name: "h", execute: () => ({}) }) });
