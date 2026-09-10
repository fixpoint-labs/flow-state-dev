/**
 * The one predicate that answers "may an agent declare this result shape?".
 *
 * An agent's declared `outputSchema` is honored on both ways of running it —
 * mounted directly and delegated to a board — so a shape that can never work
 * has to be refused before either can start. This is core's existing
 * `assertStrictCompatible` (and its `StrictSchemaError`), widened at the two
 * points that assertion does not cover on its own:
 *
 *  - **A root that is neither text nor an object.** The generator special-cases
 *    `z.string()` and forwards every other root to the provider as a
 *    structured-output root, which must be an object. `assertStrictCompatible`
 *    treats primitives as strict-safe and returns a non-object root unchanged,
 *    so `z.number()` passes it silently and fails at the model call instead.
 *  - **An output transform.** `makeSchemaStrict` deliberately unwraps
 *    `ZodEffects`, so `z.string().transform(v => new Date(v))` passes strict
 *    compatibility and parses to a `Date`. A durable board round-trips the task
 *    record through `JSON.stringify`, so that field reads back as a string
 *    after a resume — one declared shape meaning two things depending on who
 *    reads it. Refused on both shapes, so "what may I declare?" has one answer
 *    no matter how the agent is run.
 *
 * The transform walk descends objects, arrays and wrappers only. A transform
 * under a record or a non-literal union needs no separate case: core's walk
 * already refuses the record and the union themselves.
 *
 * No second error class — `AgentCapabilityError` (FIX-1327) is a posture
 * precedent, not an API one. One rule, one error type, and the generator keeps
 * its own check as the backstop for a directly-constructed generator.
 */

import {
  assertStrictCompatible,
  StrictSchemaError,
  type StrictViolation,
} from "@flow-state-dev/core";
import {
  getZodTypeName,
  getZodInnerType,
  getZodObjectShape,
  getZodArrayElement,
} from "@flow-state-dev/core/helpers";
import type { ZodTypeAny } from "zod";

/** Wrapper types that carry an inner schema without changing its root kind. */
const WRAPPERS = new Set(["ZodOptional", "ZodDefault", "ZodNullable", "ZodEffects"]);

/**
 * A `ZodEffects`' kind — `"transform"`, `"refinement"`, or `"preprocess"`.
 *
 * Read straight off `_def.effect.type`: core's `zod-introspect` centralizes
 * every `_def` access it needs and exposes no accessor for this one. Kept to a
 * single line here for the same reason (matching
 * `engine/src/resources/normalize-resource-state.ts`, which reads
 * `_def.defaultValue` the same way).
 */
function zodEffectKind(schema: ZodTypeAny): string | undefined {
  return (schema as { _def?: { effect?: { type?: string } } })._def?.effect?.type;
}

/** Peel wrappers off a schema to find the root kind the provider will see. */
function effectiveRoot(schema: ZodTypeAny): ZodTypeAny {
  let current = schema;
  const seen = new Set<ZodTypeAny>();
  while (!seen.has(current)) {
    seen.add(current);
    const typeName = getZodTypeName(current);
    if (typeName === undefined || !WRAPPERS.has(typeName)) return current;
    const inner = getZodInnerType(current);
    if (inner === undefined) return current;
    current = inner;
  }
  return current;
}

/** The declared root must be text or an object; anything else can't be sent. */
function findRootViolations(schema: ZodTypeAny): StrictViolation[] {
  const root = effectiveRoot(schema);
  const typeName = getZodTypeName(root) ?? "unknown";
  if (typeName === "ZodString" || typeName === "ZodObject") return [];
  return [
    {
      path: "$",
      typeName,
      reason:
        "a declared result must be text (z.string()) or an object — every other " +
        "root is sent to the provider as a structured-output root, which must be an object",
    },
  ];
}

/** Every output transform in the shape, tagged with where it sits. */
function findTransformViolations(schema: ZodTypeAny, path = "$"): StrictViolation[] {
  const typeName = getZodTypeName(schema);
  const issues: StrictViolation[] = [];

  if (typeName === "ZodEffects") {
    if (zodEffectKind(schema) === "transform") {
      issues.push({
        path,
        typeName,
        reason:
          "an output transform changes the parsed shape, so a result persisted " +
          "on a durable board reads back as something else after a resume — declare " +
          "the transported shape and transform where the result is read",
      });
    }
    const inner = getZodInnerType(schema);
    if (inner) issues.push(...findTransformViolations(inner, path));
    return issues;
  }

  if (typeName !== undefined && WRAPPERS.has(typeName)) {
    const inner = getZodInnerType(schema);
    if (inner) issues.push(...findTransformViolations(inner, path));
    return issues;
  }

  if (typeName === "ZodObject") {
    for (const [key, value] of Object.entries(getZodObjectShape(schema) ?? {})) {
      issues.push(...findTransformViolations(value, `${path}.${key}`));
    }
    return issues;
  }

  if (typeName === "ZodArray") {
    const element = getZodArrayElement(schema);
    if (element) issues.push(...findTransformViolations(element, `${path}[]`));
  }

  return issues;
}

/**
 * Throw a {@link StrictSchemaError} naming `agentName` and every offending
 * field path if `schema` is a result shape an agent may not declare. A no-op on
 * a declarable one.
 *
 * Every violation the schema carries is reported in one throw — the strict-mode
 * ones core already finds, plus the two widenings above — so an author fixing a
 * shape sees all of it at once.
 */
export function assertDeclarableOutputSchema(
  schema: ZodTypeAny,
  agentName: string,
): void {
  const label = `Agent "${agentName}"`;
  const violations: StrictViolation[] = [
    ...findRootViolations(schema),
    ...findTransformViolations(schema),
  ];

  try {
    assertStrictCompatible(schema, label);
  } catch (error) {
    if (!(error instanceof StrictSchemaError)) throw error;
    violations.push(...error.violations);
  }

  if (violations.length > 0) throw new StrictSchemaError(violations, label);
}
