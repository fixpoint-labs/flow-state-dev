/**
 * Regression spec for OpenAI strict-mode compatibility on every generator
 * output schema in the trading-desk flow.
 *
 * The framework's `makeSchemaStrict()` strips `optional` / `default` /
 * `nullable` wrappers, but it does NOT transform `z.record()`, `z.union()`,
 * or other patterns OpenAI's strict structured-output mode rejects. This
 * spec walks each post-strict schema and fails if any of those patterns
 * survive — catching the class of bug that bit Phase 1 (and Phase 2 by
 * inheritance) repeatedly during initial development.
 *
 * See BP-016 for the rules these checks enforce.
 */
import { describe, expect, it } from "vitest";
import { makeSchemaStrict } from "@flow-state-dev/core";
import type { ZodTypeAny } from "zod";
import { thesisOutputSchema } from "../src/flows/trading-desk/phase-1/thesis-schema";
import {
  bearThesisOutputSchema,
  bullThesisOutputSchema,
  investmentThesisOutputSchema,
} from "../src/flows/trading-desk/phase-2/thesis-schemas";
import { tradeProposalOutputSchema } from "../src/flows/trading-desk/phase-3/schemas";
import {
  neutralCritiqueOutputSchema,
  personaCritiqueOutputSchema,
  riskAssessmentOutputSchema,
} from "../src/flows/trading-desk/phase-4/schemas";

type Issue = { path: string; reason: string };

/**
 * Walk a Zod schema (already passed through `makeSchemaStrict`) and collect
 * any node that would cause OpenAI strict mode to reject the resulting JSON
 * schema. The walker covers the patterns that bit us in development:
 *
 *  - Object-shape properties wrapped in `ZodOptional` / `ZodDefault` (key is
 *    dropped from `required` → strict mode rejects).
 *  - `ZodRecord` anywhere (open-keyed map → `additionalProperties: true` →
 *    strict mode rejects).
 *  - `ZodUnion` that isn't an enum-style union of literals (ambiguous
 *    `required` set across variants → strict mode rejects). Discriminated
 *    unions have the same JSON-schema shape and would also fail this check;
 *    if we adopt them later, refine this rule.
 */
function findStrictViolations(schema: ZodTypeAny, path = "$"): Issue[] {
  const def = (schema as any)._def;
  const typeName = def?.typeName as string | undefined;
  const issues: Issue[] = [];

  switch (typeName) {
    case "ZodOptional":
    case "ZodDefault":
      issues.push({
        path,
        reason: `${typeName} survived makeSchemaStrict — would drop key from required`,
      });
      issues.push(...findStrictViolations(def.innerType, path));
      break;

    case "ZodNullable":
      issues.push(...findStrictViolations(def.innerType, path));
      break;

    case "ZodRecord":
      issues.push({
        path,
        reason: "ZodRecord becomes additionalProperties=true; OpenAI strict rejects open maps",
      });
      break;

    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const options = (def.options ?? []) as ZodTypeAny[];
      const allLiterals = options.every(
        (o) => ((o as any)._def?.typeName as string | undefined) === "ZodLiteral",
      );
      if (!allLiterals) {
        issues.push({
          path,
          reason: `${typeName} of non-literal variants — strict mode requires uniform property set`,
        });
      }
      // Walk into each variant anyway so nested issues surface.
      options.forEach((opt, i) => {
        issues.push(...findStrictViolations(opt, `${path}|${i}`));
      });
      break;
    }

    case "ZodObject": {
      const shape = def.shape() as Record<string, ZodTypeAny>;
      for (const [key, value] of Object.entries(shape)) {
        issues.push(...findStrictViolations(value, `${path}.${key}`));
      }
      break;
    }

    case "ZodArray":
      issues.push(...findStrictViolations(def.type, `${path}[]`));
      break;

    case "ZodEffects":
      issues.push(...findStrictViolations(def.schema, path));
      break;

    // Primitives, enums, literals, etc. are always strict-mode safe.
    default:
      break;
  }

  return issues;
}

const cases: Array<[string, ZodTypeAny]> = [
  ["Phase 1 thesisOutputSchema", thesisOutputSchema],
  ["Phase 2 bullThesisOutputSchema", bullThesisOutputSchema],
  ["Phase 2 bearThesisOutputSchema", bearThesisOutputSchema],
  ["Phase 2 investmentThesisOutputSchema", investmentThesisOutputSchema],
  ["Phase 3 tradeProposalOutputSchema", tradeProposalOutputSchema],
  ["Phase 4 personaCritiqueOutputSchema", personaCritiqueOutputSchema],
  ["Phase 4 neutralCritiqueOutputSchema", neutralCritiqueOutputSchema],
  ["Phase 4 riskAssessmentOutputSchema", riskAssessmentOutputSchema],
];

describe("Generator output schemas are OpenAI strict-mode compatible", () => {
  for (const [name, schema] of cases) {
    it(`${name} survives makeSchemaStrict + walker with no violations`, () => {
      const strict = makeSchemaStrict(schema);
      const issues = findStrictViolations(strict);
      if (issues.length > 0) {
        const formatted = issues
          .map((i) => `  ${i.path}: ${i.reason}`)
          .join("\n");
        throw new Error(
          `${name} would fail OpenAI strict mode:\n${formatted}`,
        );
      }
      expect(issues).toEqual([]);
    });
  }
});
