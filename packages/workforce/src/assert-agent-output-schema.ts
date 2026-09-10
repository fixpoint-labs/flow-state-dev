/**
 * May an agent declare this result shape?
 *
 * Core's `assertStrictCompatible` answers most of it, and its
 * `requireTextOrObjectRoot` option answers the root — that rule belongs to core
 * because the generator routes on it, and restating it here is how the two
 * drift.
 *
 * What stays here is the half core has no way to know: a task result on a
 * durable board round-trips through `JSON.stringify` on resume, so a shape that
 * parses to a value JSON cannot carry means the declared shape and the resumed
 * shape disagree. Core deliberately supports transforms (its strict transform
 * unwraps `ZodEffects` and the original schema is what validates the response) —
 * a board is a Layer 2 fact, and this is the only caller that has one.
 *
 * Two things this does NOT refuse, both deliberate: `.refine()` /
 * `.superRefine()`, which validate without changing the parsed value, and
 * `z.preprocess()`, which transforms the *input* to a parse and leaves the
 * output type to the schema underneath.
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

/** Wrappers to descend through without changing where we are in the shape. */
const WRAPPERS = new Set(["ZodOptional", "ZodDefault", "ZodNullable", "ZodEffects"]);

/**
 * Leaf types whose parsed value JSON cannot carry back. `z.coerce.date()` is
 * the one that bites: it is a `ZodDate`, not a transform, so it reads as
 * ordinary until a resume returns the string it was stored as.
 */
const JSON_UNSAFE_LEAVES: Record<string, string> = {
  ZodDate: "a Date",
  ZodBigInt: "a BigInt",
  ZodMap: "a Map",
  ZodSet: "a Set",
  ZodSymbol: "a Symbol",
  ZodPromise: "a Promise",
  ZodFunction: "a function",
  ZodUndefined: "undefined",
  ZodVoid: "undefined",
  ZodNaN: "NaN",
};

/**
 * A `ZodEffects`' kind — `"transform"`, `"refinement"` or `"preprocess"`. Read
 * straight off `_def.effect.type`: core's `zod-introspect` exposes no accessor
 * for it (same one-line local read as `engine`'s `_def.defaultValue`).
 */
function zodEffectKind(schema: ZodTypeAny): string | undefined {
  return (schema as { _def?: { effect?: { type?: string } } })._def?.effect?.type;
}

/** Every value in the shape that a JSON round-trip would not return intact. */
function findDurabilityViolations(schema: ZodTypeAny, path = "$"): StrictViolation[] {
  const typeName = getZodTypeName(schema);
  const issues: StrictViolation[] = [];

  if (typeName !== undefined && JSON_UNSAFE_LEAVES[typeName] !== undefined) {
    issues.push({
      path,
      typeName,
      reason:
        `parses to ${JSON_UNSAFE_LEAVES[typeName]}, which a durable board's JSON ` +
        `round-trip does not return — declare the transported shape (an ISO string, ` +
        `say) and convert where the result is read`,
    });
    return issues;
  }

  if (typeName === "ZodEffects" && zodEffectKind(schema) === "transform") {
    issues.push({
      path,
      typeName,
      reason:
        "an output transform changes the parsed shape, so a result persisted on a " +
        "durable board reads back as something else after a resume",
    });
  }

  if (typeName !== undefined && WRAPPERS.has(typeName)) {
    const inner = getZodInnerType(schema);
    if (inner) issues.push(...findDurabilityViolations(inner, path));
    return issues;
  }

  if (typeName === "ZodObject") {
    for (const [key, value] of Object.entries(getZodObjectShape(schema) ?? {})) {
      issues.push(...findDurabilityViolations(value, `${path}.${key}`));
    }
    return issues;
  }

  if (typeName === "ZodArray") {
    const element = getZodArrayElement(schema);
    if (element) issues.push(...findDurabilityViolations(element, `${path}[]`));
  }

  return issues;
}

/**
 * Throw a {@link StrictSchemaError} naming `agentName` and every offending field
 * path if `schema` is a result shape an agent may not declare. A no-op on a
 * declarable one.
 *
 * Every violation is reported in one throw — core's strict-mode and root rules
 * plus the durability rule above — so an author fixing a shape sees all of it at
 * once.
 */
export function assertDeclarableOutputSchema(
  schema: ZodTypeAny,
  agentName: string,
): void {
  const label = `Agent "${agentName}"`;
  const violations: StrictViolation[] = [];

  try {
    assertStrictCompatible(schema, label, { requireTextOrObjectRoot: true });
  } catch (error) {
    if (!(error instanceof StrictSchemaError)) throw error;
    violations.push(...error.violations);
  }
  violations.push(...findDurabilityViolations(schema));

  if (violations.length > 0) throw new StrictSchemaError(violations, label);
}
