/**
 * Regression spec for OpenAI strict-mode compatibility on every generator
 * output schema shipped by `@flow-state-dev/patterns`.
 *
 * `assertStrictCompatible()` (from `@flow-state-dev/core`) runs the framework's
 * strict transform and then fails if any construct OpenAI's strict
 * structured-output mode rejects survives (a reachable `z.record`, a non-literal
 * `z.union`). Generators already call it at definition; this spec asserts the
 * shipped schema constants directly so a constant drifting out of compatibility
 * fails with a named signal before it is wired to a generator. See BP-016.
 */
import { describe, expect, it } from "vitest";
import { assertStrictCompatible } from "@flow-state-dev/core";
import type { ZodTypeAny } from "zod";
import { llmEvaluatorOutputSchema } from "../src/plan-and-execute/blocks/evaluate-progress";
import {
  executorOutputSchema,
  replannerOutputSchema,
} from "../src/plan-and-execute";
import { reviewerVerdictSchema } from "../src/supervisor/schemas";
import { controllerOutputSchema } from "../src/routedSpecialists/schemas";
import { rlmOutputSchema, subQueryOutputSchema } from "../src/rlm/schemas";
import {
  debateModeratorOutputSchema,
  debateVerdictSchema,
} from "../src/debate/schemas";
import { roundRobinRefereeOutputSchema } from "../src/round-robin/schemas";

const cases: Array<[string, ZodTypeAny]> = [
  ["plan-and-execute llmEvaluatorOutputSchema", llmEvaluatorOutputSchema],
  ["plan-and-execute replannerOutputSchema", replannerOutputSchema],
  ["plan-and-execute executorOutputSchema", executorOutputSchema],
  ["supervisor reviewerVerdictSchema", reviewerVerdictSchema],
  ["routedSpecialists controllerOutputSchema", controllerOutputSchema],
  ["rlm subQueryOutputSchema", subQueryOutputSchema],
  ["rlm rlmOutputSchema", rlmOutputSchema],
  ["debate debateModeratorOutputSchema", debateModeratorOutputSchema],
  ["debate debateVerdictSchema", debateVerdictSchema],
  ["round-robin roundRobinRefereeOutputSchema", roundRobinRefereeOutputSchema],
];

describe("Generator output schemas are OpenAI strict-mode compatible", () => {
  for (const [name, schema] of cases) {
    it(`${name} is strict-compatible`, () => {
      expect(() => assertStrictCompatible(schema, name)).not.toThrow();
    });
  }
});
